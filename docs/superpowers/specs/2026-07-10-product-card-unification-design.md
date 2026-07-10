# Design: Unificação do ProductCard

**Data:** 2026-07-10
**Autor:** Luciano Pontes (via Claude Code)
**Status:** Aprovado, aguardando plano de implementação

## Contexto

O storefront (`apps/storefront`) tem três definições locais e independentes de um componente `ProductCard`, cada uma privada ao seu próprio arquivo:

1. `apps/storefront/src/app/loja/[id]/page.tsx:115`
2. `apps/storefront/src/app/produtos/page.tsx:82`
3. `apps/storefront/src/components/product/FeaturedProducts.tsx:47`

Não existe um `ProductCard.tsx` compartilhado — isso foi identificado através de uma análise de grafo de conhecimento do repositório (`/graphify`), que apontou os três `ProductCard()` como nós isolados em comunidades diferentes apesar de nome e assinatura de props idênticos (`{ product: Product }`).

As três implementações começaram idênticas mas divergiram em três pontos:

| Ponto | `loja/[id]/page.tsx` | `produtos/page.tsx` | `FeaturedProducts.tsx` |
|---|---|---|---|
| `sizes` da imagem | `...33vw, 25vw` | `...33vw, 16vw` | `...33vw, 16vw` |
| `bg-white` no container | presente | presente | ausente |
| Fallback sem preço BRL | nada renderizado | `"Ver preço"` | `"Consulte o preço"` |

A divergência de `sizes` é legítima (grids com números de colunas diferentes: `loja/[id]` usa até 4 colunas, as outras duas até 6). As outras duas divergências (`bg-white` e fallback de preço) são inconsistências acidentais de manutenção paralela.

## Fora de escopo

O mesmo padrão de duplicação existe em `SellerCard` (`apps/storefront/src/components/seller/FeaturedSellers.tsx` e `apps/storefront/src/app/lojas/page.tsx`). Foi identificado durante a análise mas fica fora deste spec — será tratado como um item separado.

## Decisões

1. **Fallback de preço sem BRL:** sempre renderizar `"Consulte o preço"`, substituindo os três comportamentos atuais divergentes.
2. **`sizes` da imagem:** vira uma prop opcional `sizes?: string`, com default `"(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"` (valor hoje usado em `produtos` e `FeaturedProducts`). `loja/[id]/page.tsx` passa explicitamente `"(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"` para preservar seu grid de 4 colunas.
3. **`bg-white` no container:** sempre presente no componente unificado, garantindo aparência consistente do card independente do fundo da página/seção pai.

## Arquitetura

Novo arquivo: `apps/storefront/src/components/product/ProductCard.tsx`, exportando um único componente nomeado `ProductCard`.

```ts
type ProductCardProps = {
  product: Product
  sizes?: string
}
```

- `product`: reutiliza o tipo `Product` já exportado de `apps/storefront/src/lib/api.ts` — sem mudanças ao tipo.
- `sizes`: opcional, conforme decisão 2 acima.

As três definições locais existentes são removidas e substituídas por:
```ts
import { ProductCard } from '@/components/product/ProductCard'
```

### Comportamento do componente

- Busca a variante com `currency_code === 'brl'` em `product.variants?.[0]?.prices` (lógica idêntica à atual, sem mudanças).
- Renderiza imagem (via `next/image`, com fallback de emoji `🛍️` quando `product.thumbnail` está ausente — comportamento atual preservado), título, e link para `/produto/{product.handle}`.
- Renderiza preço formatado via `formatPrice()` (de `@/lib/api`) quando há preço BRL; caso contrário renderiza `"Consulte o preço"` (decisão 1).
- Container sempre com `bg-white` (decisão 3).

## Mudança de comportamento visível ao usuário

Duas páginas terão comportamento ligeiramente diferente do atual após a migração:

- **`loja/[id]/page.tsx`**: hoje não mostra nada quando falta preço BRL → passa a mostrar `"Consulte o preço"`.
- **`produtos/page.tsx`**: hoje mostra `"Ver preço"` → passa a mostrar `"Consulte o preço"`.

`FeaturedProducts.tsx` não muda de comportamento visível (já usa `"Consulte o preço"` e já está sobre uma seção com fundo branco, então adicionar `bg-white` ao card não altera a aparência).

## Testes

Novo arquivo `apps/storefront/src/components/product/__tests__/ProductCard.test.tsx`, seguindo o padrão de nomenclatura já usado no projeto (ver `apps/storefront/src/components/product/__tests__/CategorySelect.test.tsx`), cobrindo o `ProductCard` isoladamente:

1. Renderiza título e imagem do produto.
2. Renderiza preço formatado (via `formatPrice`) quando há variante com `currency_code === 'brl'`.
3. Renderiza `"Consulte o preço"` quando não há variante BRL.
4. O link aponta para `/produto/{handle}`.
5. Aplica o valor de `sizes` passado via prop, e usa o default quando a prop é omitida.

Não estão incluídos smoke tests separados das três páginas que passam a consumir o componente — a cobertura do componente isolado é considerada suficiente, já que as páginas passam a apenas importar e renderizar um componente já testado.

## Fora de escopo (explícito)

- Unificação do `SellerCard` (ver seção "Fora de escopo" acima).
- Qualquer mudança de layout/CSS além das três divergências documentadas.
- Mudança ao tipo `Product` ou à função `formatPrice()`.
