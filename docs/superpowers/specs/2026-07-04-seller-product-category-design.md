# Design — Categoria no cadastro/edição de produto do lojista

**Data**: 2026-07-04
**Contexto**: Fase 2 do roadmap pós-PR#3 (`HANDOFF.md`). Gap de plataforma confirmado: `POST /seller/products` não permite ao lojista escolher categoria do produto. Investigação mostrou que o gap é mais amplo — `PATCH` (editar) e `GET` (listagem/detalhe) também não expõem categoria.

## Problema

O painel do lojista (`painel/produtos/*`) não tem nenhuma noção de categoria de produto. Isso não bloqueia a migração Nuvemshop→MAB (categorias já setadas no import), mas bloqueia qualquer lojista cadastrando produtos novos: o produto fica sem categoria, o que já se mostrou problemático para busca/filtro por categoria na vitrine (Fase 0/PR#3).

## Decisões de escopo

| Decisão | Escolha |
|---|---|
| Escopo | Completo: criar + editar + exibir (não só criação) |
| Multiplicidade | Uma categoria por produto |
| Origem das categorias | Só as já cadastradas pelo admin (curadas) — lojista não cria categoria nova |
| Obrigatoriedade | Opcional — produto pode ficar sem categoria |
| Testes de frontend | Sem infraestrutura de React Testing Library nesta fase (ver seção Testes) |

## Backend

### `POST /seller/products` (`packages/medusa-backend/apps/backend/src/api/seller/products/route.ts`)

- `CreateProductSchema` ganha `category_id: z.string().optional()`.
- Antes de chamar `createProducts`, se `category_id` foi enviado, valida com `productService.listProductCategories({ id: [category_id] })`. Se não encontrar, retorna `400 { error: "Categoria não encontrada" }`.
- Passa `category_ids: category_id ? [category_id] : undefined` para `productService.createProducts([...])` — o `CreateProductDTO` do módulo já suporta `category_ids` nativamente, sem necessidade de workflow ou link manual.

### `PATCH /seller/products/:id` (`.../products/[id]/route.ts`)

- `UpdateProductSchema` ganha `category_id: z.string().nullable().optional()`. Três estados:
  - chave ausente do body → não mexe na categoria atual (não inclui `category_ids` no update)
  - `category_id: null` → remove a categoria (`category_ids: []`)
  - `category_id: "<id>"` → define a categoria (`category_ids: ["<id>"]`), com a mesma validação de existência do POST (400 se não encontrado)

### `GET /seller/products` (listagem)

- Adiciona `products.categories.id`, `products.categories.name` aos `fields` do `query.graph` já existente.
- É esta rota, não a de detalhe, que hoje alimenta a tela de edição do frontend (`getSellerProducts`) — por isso é a mudança que efetivamente importa para a UI.

### `GET /seller/products/:id` (detalhe)

- Troca `productService.listProducts({ id: [id] })` por `productService.listProducts({ id: [id] }, { relations: ["categories"] })`.
- Não é consumida pelo frontend hoje; corrigida por completude/consistência da API.

### Fonte da lista de categorias

Nenhuma rota nova de categorias no backend. O frontend reaproveita `/store/product-categories` (endpoint público já existente e usado pela vitrine) — categoria não é dado sensível nem específico de lojista.

## Frontend

Componente novo **`CategorySelect`** (client component, reaproveitado em criar e editar):
- Busca categorias com o `listCategories()` já existente em `apps/storefront/src/lib/api.ts`.
- `<select>` simples: opção vazia "Sem categoria" + lista por `name`.
- Se o fetch falhar, degrada para só a opção "Sem categoria" — não bloqueia o formulário.
- Recebe `value`/`onChange` como campo controlado, mesmo padrão dos outros campos do form.

**`painel/produtos/novo/page.tsx`**: adiciona `category_id: ''` ao estado do form; `<Field label="Categoria">` com `<CategorySelect>`; envia `category_id: form.category_id || undefined` no payload de `createSellerProduct`.

**`painel/produtos/[id]/page.tsx`**: adiciona `category_id: string` ao tipo `ProductForm`; pré-preenche com `product.categories?.[0]?.id ?? ''` (vindo da listagem); mesmo `<Field>`/`<CategorySelect>`; envia `category_id: form.category_id || null` no payload de `updateSellerProduct` (usa `null` explícito para permitir remover a categoria, consistente com a semântica de 3 estados do backend).

**`painel/produtos/page.tsx`** (listagem): adiciona coluna "Categoria" na tabela, padrão `hidden sm:table-cell` (igual Preço/Status), mostrando `product.categories?.[0]?.name ?? '—'`.

## Tratamento de erros

- Categoria inexistente → `400 { error: "Categoria não encontrada" }`, sem tentar criar/atualizar (validação prévia, não parsing de erro de FK do banco).
- Falha ao carregar lista de categorias no painel → `CategorySelect` degrada para "Sem categoria", não bloqueia o resto do form.
- MeiliSearch: sem impacto. O subscriber de indexação de produto (`product-search-index.ts`) indexa `seller.category` (segmento do lojista), não `product_category` — confirmado por leitura do código.

## Testes

**Backend** (Jest, padrão `__tests__/route.unit.spec.ts` já usado em outras rotas do backend, mockando `req.scope.resolve`):
- POST cria produto com `category_id` válido → `category_ids: [id]` repassado a `createProducts`
- POST sem `category_id` → `category_ids` não enviado
- POST com `category_id` inexistente → 400, `createProducts` não é chamado
- PATCH com `category_id` string válido → `category_ids: [id]`
- PATCH com `category_id: null` → `category_ids: []`
- PATCH sem a chave `category_id` no body → `category_ids` ausente do update
- PATCH com `category_id` inexistente → 400
- GET listagem/detalhe → categoria presente na resposta

**Frontend**: o storefront só tem `vitest` configurado para funções puras (`src/lib/__tests__/format.test.ts`); não há React Testing Library nem infraestrutura de teste de componente. Decisão explícita: **não** introduzir essa infra nesta feature (fora de escopo). Cobertura da UI (`CategorySelect`, formulários) fica por verificação manual no navegador antes de encerrar a implementação. Se alguma lógica pura for extraída (ex: mapeamento `category_id` → payload), essa parte ganha teste `vitest` isolado.

## Fora de escopo (não incluído nesta feature)

- Lojista criar categoria nova (fica com o admin, via dashboard Medusa já existente).
- Múltiplas categorias por produto.
- Qualquer mudança em categorias na vitrine pública (`/store/product-categories`, páginas de categoria já existentes).
