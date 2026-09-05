# Frete Segmentado por Loja — Escopo para Brainstorming Futuro

**Status**: Não iniciado. Levantamento preliminar feito em 27/08/2026 durante o design do split de pedido por vendedor (`docs/superpowers/specs/2026-08-27-multi-seller-cart-order-split-design.md`). Este documento **não é um spec aprovado** — é um registro do que já foi descoberto, para não perder o levantamento quando a feature for priorizada. Passar pelo processo de brainstorming completo (perguntas, abordagens, design, aprovação) antes de implementar.

## Motivação

O split de pedido por vendedor (spec irmão deste documento) resolve a atribuição de pedido/comissão/NF-e por loja, mas **não** resolve o frete: hoje o valor de frete de um pedido multi-vendedor é um rateio proporcional do subtotal, não um cálculo real por origem de cada loja. Cada vendedor é, na prática, uma loja com endereço próprio — o frete real deveria refletir isso.

## Estado atual (lido do código, 27/08/2026)

- `api/store/shipping/estimate/route.ts`: uma única chamada à API do Melhor Envio por carrinho, origem fixa em `MELHOR_ENVIO_ORIGIN_CEP` (env var única para toda a plataforma), destino = CEP do comprador. Peso/dimensão do pacote também são fixos (`weight=1` default), não vêm do produto.
- `modules/seller/models/seller.ts`: **não tem nenhum campo de endereço ou CEP** — não há de onde ler uma origem por vendedor hoje.
- `apps/storefront/src/lib/cart-store.ts`: `selectedShipping` é uma tarifa única para o carrinho inteiro (`ShippingRate | null`) — não há modelo de "uma tarifa por vendedor".
- Fluxo de checkout (`app/checkout/page.tsx`) mostra uma única etapa de escolha de frete para todo o carrinho.

## O que precisaria ser resolvido

1. **Dado novo**: endereço/CEP de origem no cadastro do vendedor — campo no modelo `seller.ts` (migration) + formulário no painel do lojista (`painel/perfil` ou fluxo de cadastro) para o vendedor informar.
2. **Cálculo por loja**: `shipping/estimate` (ou uma rota nova) precisa aceitar agrupamento de itens por vendedor e chamar a API do Melhor Envio uma vez por vendedor presente no carrinho, retornando um conjunto de tarifas por loja em vez de um único conjunto.
3. **UX de checkout**: o comprador precisa escolher (ou o sistema precisa auto-selecionar, a decidir) uma transportadora **por loja**, não uma só para o carrinho inteiro — muda a etapa "Frete" do checkout e o estado de `cart-store.ts` (`selectedShipping` viraria algo como `Record<sellerId, ShippingRate>`).
4. **Integração com o split de pedido**: o `shippingShare` hoje calculado por rateio proporcional (spec irmão) passaria a usar o valor real de frete escolhido para aquele vendedor, em vez de uma fração do frete total.
5. **Peso/dimensão real**: pra cotação ficar precisa de verdade, o produto precisaria carregar peso/dimensões (hoje fixo em `weight=1`) — decisão em aberto se isso entra no mesmo ciclo ou fica pra depois ainda.

## Perguntas em aberto para o brainstorming

- Auto-selecionar a opção mais barata por loja, ou obrigar o comprador a escolher manualmente cada uma?
- Vendedor sem CEP cadastrado (dado legado/migração): bloqueia venda até completar cadastro, ou cai num frete padrão/estimado?
- Vale a pena, no mesmo ciclo, adicionar peso/dimensão ao produto — ou aceitar cotação aproximada (peso fixo) por mais um tempo?
