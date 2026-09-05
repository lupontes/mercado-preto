# Split de Pedido por Vendedor no Checkout — Design

**Status**: Aprovado pelo usuário, pronto para plano de implementação.

## Problem

Teste manual de 25/08 (`docs/qa/2026-08-25-multi-seller-order-test.md`) apontou suspeita de que um carrinho com produtos de vendedores diferentes atribuiria o pedido inteiro a um único vendedor. Investigação no código revelou que o problema é mais grave: **o storefront nunca envia `sellerId` em nenhum checkout, hoje — nem em carrinho de vendedor único.**

Consequência confirmada lendo o código:
- `commission-on-payment.ts:37` e `order-fiscal-emit.ts:28/39` caem no fallback `"unknown"` quando `order.metadata.seller_id` não vem preenchido — o que é sempre, hoje.
- `api/seller/orders/route.ts:11` filtra o painel de pedidos do vendedor por `metadata.seller_id === sellerId`.

Ou seja: **nenhum vendedor consegue ver nenhum pedido no painel dele hoje**, em nenhum ambiente — todo pedido nasce com `seller_id: "unknown"`. Isso vale tanto para produção quanto para o ambiente de teste (`teste.mercadopreto.com.br`).

## Current State (read from code, 2026-08-27)

- **Carrinho** (`apps/storefront/src/lib/cart-store.ts`): `CartItem` guarda `productId`, `variantId`, `title`, `variantTitle`, `thumbnail`, `price`, `quantity`. Não tem noção de vendedor.
- **Add to cart** (`apps/storefront/src/components/cart/AddToCartButton.tsx`, chamado por `components/product/ProductDetails.tsx`, chamado por `app/produto/[handle]/page.tsx`): recebe `productId` da página do produto, mas nunca resolve nem passa `sellerId`.
- **Checkout** (`apps/storefront/src/app/checkout/page.tsx:62-81`, função `createPreference`): monta `POST /store/checkout/preference` com `{ items, address, shipping, total, document }` — sem `sellerId`. O array `items` enviado (linha 149) é montado como `{ title, quantity, price, variantId }` — **`productId` do `CartItem` é descartado antes do fetch**, não chega ao backend hoje.
- **Backend, criação da preferência** (`packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`): schema Zod do item tem só `title`, `quantity`, `price`, `variantId?` (linhas 9-14, sem `productId`); schema do body tem `sellerId: z.string().optional()` (linha 33); grava `metadata.seller_id: sellerId` (linha 110) — sempre `undefined`, já que o frontend nunca envia.
- **Webhook de pagamento aprovado** (`.../api/webhooks/mercadopago/route.ts:150-201`): recupera `metadata` da preferência via `external_reference`, cria **um único pedido** (`orderService.createOrders([...])`, linha 159) com `metadata.seller_id: meta?.seller_id` (linha 186), depois emite `order.placed` e `mercadopago.order_approved` para esse pedido.
- **Comissão** (`subscribers/commission-on-payment.ts`, evento `order.payment_captured` — emitido internamente pelo Medusa Order module ao criar o pedido, não por código deste repo): lê `order.metadata.seller_id`, fallback `"unknown"` (linha 37).
- **NF-e** (`subscribers/order-fiscal-emit.ts`, evento `mercadopago.order_approved`): lê `order.metadata.seller_id`, fallback `"unknown"` (linha 28, usado na linha 39).
- **Link Medusa já existe**: `links/seller-product.ts` define `seller` (1) ↔ `product` (N) — dá para resolver o vendedor de um produto via `query.graph`, sem link novo.
- **Frete**: `api/store/shipping/estimate/route.ts` calcula uma única cotação para o carrinho inteiro, a partir de uma origem fixa (`MELHOR_ENVIO_ORIGIN_CEP`) — não há conceito de origem por vendedor. O modelo `seller.ts` não tem campo de endereço/CEP. Isso é uma limitação pré-existente, documentada separadamente para tratamento futuro (`docs/superpowers/specs/2026-08-27-frete-segmentado-por-loja-scope.md`) — **fora do escopo deste design**.
- **Confirmação de compra** (`app/checkout/sucesso/ConfirmationContent.tsx`): busca `GET /store/checkout/confirm?payment_id=...`, que por sua vez (`api/store/checkout/confirm/route.ts`) devolve direto o que a API do MercadoPago tem sobre o pagamento (`payment.metadata`) — não depende do Order module nem de um pedido específico.

## Goal

Comprador paga **uma vez só** por um carrinho com produtos de vendedores diferentes. O backend cria **um pedido por vendedor** a partir desse único pagamento, cada um com `seller_id` correto — o que corrige, de quebra, a atribuição de todo pedido (inclusive os de vendedor único, que hoje também nascem `"unknown"`).

## Non-Goals

- **Não implementa frete segmentado por loja** — o rateio do frete entre os pedidos gerados é proporcional ao subtotal de cada grupo, não um cálculo real por origem. Ver spec separado.
- **Não implementa split real de pagamento via MercadoPago** (sub-contas OAuth, item "Split de pagamento MP" do roadmap) — o dinheiro continua indo inteiro para a conta MP da plataforma, como já é hoje. O repasse por vendedor continua pelo fluxo manual de `payout` que já existe, agora recebendo comissões corretamente atribuídas em vez de `"unknown"`.
- **Não muda a UX de seleção de frete** — continua uma única tarifa escolhida para o carrinho inteiro.
- **Não migra pedidos `"unknown"` já existentes** no banco de teste — dado de teste, descartável.
- **Não adiciona `sellerId` ao carrinho do navegador** (`cart-store.ts` não muda) — resolução de vendedor é 100% server-side, ver justificativa no Design.

## Design

### Por que resolver o vendedor no backend, não no carrinho

O carrinho é dado do cliente. Se o `sellerId` de cada item fosse decidido no navegador e enviado ao backend, um comprador mal-intencionado poderia adulterar essa informação para desviar comissão/atribuição de pedido para o vendedor errado — um problema de integridade financeira, não só de UX. Resolver o vendedor de cada item no backend, a partir do `productId` (dado que já existe em cada `CartItem` no navegador e não pode ser falsificado de forma útil, pois o produto tem que existir de verdade — o pior que um `productId` adulterado faz é resolver para outro vendedor real, nunca desviar comissão sem associar a um pedido real desse vendedor), elimina essa superfície de ataque de "escolher o vendedor livremente" e evita qualquer mudança na lógica de `cart-store.ts` ou nos componentes de carrinho — só precisa parar de descartar um campo que já existe.

### `checkout/preference/route.ts` (e o envio do checkout no frontend)

**Frontend** (`apps/storefront/src/app/checkout/page.tsx`): a função `createPreference` (linha 62) passa a aceitar `productId` em cada item de entrada, e o `.map` da linha 149 (chamada em `handlePayment`/equivalente) passa a incluir `productId: i.productId` junto de `title`/`quantity`/`price`/`variantId` — o dado já existe em `CartItem`, só estava sendo descartado antes do fetch.

**Backend**: o item do schema Zod ganha `productId: z.string()` (obrigatório, não mais um dado opcional que fica sem uso). O campo `sellerId: z.string().optional()` do body sai do schema — nunca foi preenchido pelo frontend e a resolução passa a ser sempre server-side. Após validar:

1. Resolve o vendedor de cada item via `query.graph` (mesmo padrão de `ContainerRegistrationKeys.QUERY` já usado em `api/store/sellers/[id]/products/route.ts`), usando o `productId` de cada item contra o link `seller-product` (`entity: "product"`, `fields: ["id", "seller.id"]`, `filters: { id: productIds }`). Nome exato do campo reverso do link (`seller.id` vs. alternativa) a confirmar na primeira rodada de TDD — o link já existe, é questão de sintaxe de query.
2. Agrupa os itens da requisição por `sellerId` resolvido. Se algum item não tiver produto/vendedor encontrado (produto deletado ou dado inconsistente), a rota responde `400` com uma mensagem clara — em vez de deixar cair em `"unknown"` silenciosamente como acontece hoje.
3. Para cada grupo: soma o subtotal (`price * quantity` dos itens do grupo) e calcula a fração do frete: `shippingShare = round(shipping.price * groupSubtotal / cartSubtotal)`. O resto de centavos da divisão (para o total fechar exato) vai para o grupo de maior subtotal.
4. Grava em `metadata.seller_groups: Array<{ sellerId: string; subtotal: number; shippingShare: number; items: Array<{ variant_id?: string; title: string; quantity: number; price: number }> }>` na preferência MercadoPago, no lugar do atual `metadata.seller_id` (removido). Os campos `metadata.items`, `metadata.shipping`, `metadata.total` **continuam existindo tal como hoje** — são a visão "carrinho inteiro" usada pela tela de confirmação, que não muda.

### `webhooks/mercadopago/route.ts` (pagamento aprovado)

Troca a criação de um único pedido (linhas 159-190 hoje) por:

1. Lê `meta.seller_groups` (array). Se ausente (pagamento antigo, pré-migração — não deve ocorrer em produção nova, mas é defensivo), cai no comportamento atual como um único grupo com `seller_id: undefined` — mantém compatibilidade sem quebrar.
2. Idempotência: a checagem atual (`existingOrders` por `metadata.mercadopago_external_reference`, linhas 150-157) passa a filtrar também por `metadata.seller_id`, uma checagem por grupo — só cria os pedidos que ainda não existem para aquele `(external_reference, seller_id)`. Isso cobre reprocessamento parcial (ex.: MP reenvia o webhook depois de uma falha no meio da criação dos N pedidos).
3. Para cada grupo pendente de criação, monta o input de `createOrders` igual ao formato atual (linhas 159-189), mas com `items` apenas do grupo, `shipping_methods: [{ name: shipping.name, amount: group.shippingShare }]`, e `metadata.seller_id: group.sellerId` (valor real, nunca mais `"unknown"`).
4. Chama `orderService.createOrders(pendingGroupInputs)` uma vez com todos os grupos pendentes (array), recebendo de volta os pedidos criados.
5. Para cada pedido criado, emite `order.placed` e `mercadopago.order_approved` (mesmo par de eventos de hoje, um disparo por pedido) — `commission-on-payment.ts` e `order-fiscal-emit.ts` não mudam, já operam por `order.id` e já são idempotentes por pedido (`commissionService.listCommissions({ orderId })`, linha 42 do subscriber de comissão).

### Carrinho de vendedor único

Não é um caso especial: é o caminho com `seller_groups.length === 1`. Mesmo código, sem branch dedicado — e é isso que corrige, para todo pedido novo, o bug atual de `seller_id: "unknown"`.

### Tela de confirmação (`ConfirmationContent.tsx`)

Sem mudança. Continua lendo `payment.metadata.items` / `.shipping` / `.total` (a visão "carrinho inteiro", preservada no passo 4 do design da rota de preferência) — não lista pedidos individuais nem precisa saber quantos foram criados.

## Error Handling

- Item de carrinho sem vendedor resolvível em `checkout/preference` → `400` com detalhe (nunca chega a criar preferência de pagamento para um carrinho com dado inconsistente).
- `meta.seller_groups` ausente no webhook (formato antigo) → fallback para um único grupo sem `seller_id`, mesmo comportamento de hoje — não quebra pagamentos em voo durante o deploy desta mudança.
- Falha ao criar parte dos N pedidos (ex.: erro de banco no meio do array) → como o MP reenvia webhooks de pagamento não confirmados por um `200`, o reprocessamento subsequente só cria os pedidos que ainda faltam (idempotência por grupo, ver Design item 2 acima).

## Testing

Frontend (`*.test.ts`, Vitest):
- `checkout/page.tsx` (ou o módulo onde `createPreference` vive, se extraído): o corpo enviado a `POST /store/checkout/preference` inclui `productId` de cada item do carrinho.

Backend (`*.unit.spec.ts`, TDD):
- `checkout/preference/route.ts`: `400` quando um item chega sem `productId` (schema); agrupamento de itens por vendedor resolvido via `query.graph` (mock); cálculo de `subtotal`/`shippingShare` por grupo, incluindo o caso do resto de centavos; `400` quando um item não resolve vendedor; carrinho de vendedor único produz um `seller_groups` com um elemento.
- `webhooks/mercadopago/route.ts`: pagamento aprovado com `seller_groups` de 2+ vendedores cria N pedidos, cada um com `seller_id` correto, itens e `shippingShare` corretos; reprocessamento do mesmo webhook com 1 dos N pedidos já existente cria só os que faltam; carrinho de vendedor único continua criando exatamente 1 pedido (teste de regressão — `seller_id` não é mais `"unknown"`); fallback de compatibilidade quando `seller_groups` está ausente.
- Regressão: `commission-on-payment.ts` e `order-fiscal-emit.ts` não mudam de código, mas os testes existentes que hoje esperam `sellerId "unknown"` como cenário válido devem ser revistos — esse fallback deixa de ser o caminho normal.

Verificação manual em `teste.mercadopreto.com.br` pós-deploy: montar carrinho com produtos de 2 lojas diferentes, pagar uma vez (cartão sandbox `TEST-`), confirmar que aparecem 2 pedidos distintos, um em cada painel de vendedor, com comissão e NF-e (sandbox) emitidas para cada um.
