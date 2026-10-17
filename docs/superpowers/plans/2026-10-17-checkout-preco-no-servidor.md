# Preço do Checkout no Servidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nenhum valor cobrado ou gravado nos pedidos vem do navegador: preço e título dos itens saem do banco, o Brick cobra o total do snapshot e o webhook só cria pedidos quando o valor aprovado bate com esse total.

**Architecture:** Uma função nova (`resolveCheckoutItems`) troca preço e título dos itens pelos do banco antes da recotação do frete, e responde 409 se o preço mudou. O snapshot do checkout ganha um estado (`status`, `paymentId`, `ordersCreatedAt`) com transições condicionais em SQL, que garantem um único vencedor. O Brick e o webhook usam essas transições.

**Tech Stack:** Medusa v2 (módulo DML, MikroORM), Mercado Pago SDK, Jest (backend), Next.js com Vitest (vitrine), zustand.

**Spec:** `docs/superpowers/specs/2026-10-17-checkout-preco-no-servidor-design.md`

## Global Constraints

- Código, identificadores e comentários em inglês. Mensagens ao comprador e logs seguem o português já usado nas rotas.
- Commits em Conventional Commits, com a descrição em pt-BR no imperativo e em minúsculas, e com o trailer de co-autoria da sessão.
- O backend usa **npm**, não pnpm (`packages/medusa-backend`). A vitrine usa pnpm.
- Valores em centavos (inteiros) em todo o backend. O Mercado Pago recebe reais (`/ 100`).
- Preço vigente de uma variante: o primeiro item de `variant.prices` com `currency_code === "brl"`, a mesma regra de `ProductDetails.tsx`.
- Erro de carrinho desatualizado: **400** com `CART_ITEM_UNAVAILABLE_MESSAGE` (`utils/shipping-quote.ts`), sem ids internos.
- Status de snapshot `null` (snapshots antigos) é tratado como `pending` em todo lugar.
- Comparação no webhook: `Math.round(payment.transaction_amount * 100) === payload.total`. Não usar `total_paid_amount`.
- Um snapshot vira pedido por no máximo um pagamento. `amount_mismatch` é terminal.

Caminhos abaixo: `BE = packages/medusa-backend/apps/backend/src`, `SF = apps/storefront/src`.
Testes do backend: `cd packages/medusa-backend/apps/backend && npm run test:unit -- <caminho>`.
Testes da vitrine: `cd apps/storefront && pnpm vitest run <caminho>`.

## Review Focus

- **Vitrine antiga durante o deploy** ainda manda `transaction_amount` ao Brick: a rota tem que aceitar e ignorar o campo (Task 4).
- **Webhook que chega depois de o Brick marcar `paid`** com o mesmo `payment.id`: precisa criar os pedidos, não tratar como duplicado (Task 5).
- **Arredondamento de float** (`10.1 * 100 = 1009.9999…`): não pode gerar falso divergente (Task 5).
- **Mesma variante em duas linhas do carrinho:** a resolução não pode descartar nem duplicar linhas (Task 2).
- **Snapshot antigo com `status` nulo:** precisa funcionar como `pending` nas transições condicionais (Task 1).

---

### Task 1: Estado do snapshot com transições atômicas

**Files:**
- Modify: `BE/modules/checkout/models/checkout-snapshot.ts`
- Create: `BE/modules/checkout/migrations/Migration20261017120000.ts`
- Modify: `BE/modules/checkout/service.ts`
- Modify: `BE/modules/checkout/__tests__/service.unit.spec.ts`
- Create: `BE/modules/checkout/__tests__/service.integration.spec.ts`

**Interfaces:**
- Produces:
  - `type SnapshotStatus = "pending" | "paid" | "amount_mismatch"` (exportado de `service.ts`)
  - `recordSnapshot(externalReference: string, payload: Record<string, unknown>, initial?: { status?: SnapshotStatus; paymentId?: string; ordersCreatedAt?: Date }): Promise<unknown>`
  - `findByExternalReference(ref)`: retorna também `status`, `paymentId` e `ordersCreatedAt`, como já retorna o registro inteiro
  - `transitionFromPending(externalReference: string, to: "paid" | "amount_mismatch", paymentId: string): Promise<boolean>`: `true` só para quem mudou a linha
  - `claimOrderCreation(externalReference: string): Promise<boolean>`: `ordersCreatedAt` de nulo para agora; `true` só para quem mudou
  - `releaseOrderCreation(externalReference: string): Promise<void>`: volta `ordersCreatedAt` para nulo

- [ ] **Step 1: Model e migration.** Adicionar `status: model.text().nullable()`, `paymentId: model.text().nullable()` e `ordersCreatedAt: model.dateTime().nullable()`. A migration `Migration20261017120000` faz `alter table "checkout_snapshot" add column if not exists` para `"status" text null`, `"paymentId" text null` e `"ordersCreatedAt" timestamptz null`. O `down` remove as três. As colunas seguem o padrão camelCase entre aspas da migration `Migration20260829223000`.

- [ ] **Step 2: Teste unitário que falha:** `recordSnapshot("ref", payload, { status: "paid", ordersCreatedAt: d })` chama `createCheckoutSnapshots` com `{ externalReference: "ref", payload, status: "paid", ordersCreatedAt: d }`, e `recordSnapshot("ref", payload)` continua chamando com só `{ externalReference, payload }`.

- [ ] **Step 3:** Rodar `npm run test:unit -- src/modules/checkout`. Esperado: FAIL no teste novo.

- [ ] **Step 4: Implementar `recordSnapshot` com `initial`** e as três transições. As transições usam `@InjectManager()` com `@MedusaContext() sharedContext` e SQL bruto pelo manager do contexto. É uma única instrução `UPDATE … RETURNING id`, e o resultado é `true` se e só se voltar uma linha:
  - `transitionFromPending`: `set "status" = ?, "paymentId" = ?, updated_at = now() where "externalReference" = ? and coalesce("status", 'pending') = 'pending' and deleted_at is null`
  - `claimOrderCreation`: `set "ordersCreatedAt" = now() where "externalReference" = ? and "ordersCreatedAt" is null and deleted_at is null`
  - `releaseOrderCreation`: `set "ordersCreatedAt" = null where "externalReference" = ?`

  Não usar "ler e depois atualizar": a garantia de vencedor único vem do `WHERE`.

- [ ] **Step 5:** Rodar `npm run test:unit -- src/modules/checkout`. Esperado: PASS.

- [ ] **Step 6: Teste de integração** com `moduleIntegrationTestRunner` de `@medusajs/test-utils` (`moduleName: CHECKOUT_MODULE`, `resolve: "./src/modules/checkout"`), com estes casos:
  - `transitionFromPending` em snapshot novo devolve `true`, e a releitura mostra `status: "paid"` e `paymentId: "p1"`;
  - uma segunda chamada (`"p2"`) devolve `false`, e `paymentId` continua `"p1"`;
  - `Promise.all` de 5 chamadas simultâneas gera exatamente um `true`;
  - snapshot gravado com `status` nulo (simular legado) aceita a transição;
  - `amount_mismatch` não volta a `paid`;
  - `claimOrderCreation` devolve `true` uma vez e `false` depois; após `releaseOrderCreation`, devolve `true` de novo.

- [ ] **Step 7:** Rodar com um Postgres descartável:

  ```bash
  docker run -d --rm --name pg-checkout-test -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
  cd packages/medusa-backend/apps/backend
  DB_HOST=localhost DB_PORT=55432 DB_USERNAME=postgres DB_PASSWORD=postgres \
    npm run test:integration:modules -- src/modules/checkout/__tests__/service.integration.spec.ts
  docker stop pg-checkout-test
  ```

  Esperado: PASS. Se o runner não subir neste ambiente, parar e reportar. Não trocar o teste por mock.

- [ ] **Step 8: Commit** `feat(checkout): registrar estado do pagamento no snapshot com transições atômicas`

### Task 2: Resolver preço e título dos itens no servidor

**Files:**
- Create: `BE/utils/checkout-items.ts`
- Create: `BE/utils/__tests__/checkout-items.unit.spec.ts`

**Interfaces:**
- Consumes: `CheckoutRequest` (`utils/checkout-payload.ts`), `CART_ITEM_UNAVAILABLE_MESSAGE` (`utils/shipping-quote.ts`)
- Produces:
  - `type PriceChange = { variantId: string; price: number; title: string }`
  - `PRICE_CHANGED_MESSAGE = "O preço de alguns produtos foi atualizado"`
  - `resolveCheckoutItems(query: { graph: (args: any) => Promise<{ data: any[] }> }, items: CheckoutRequest["items"]): Promise<{ ok: true; items: CheckoutRequest["items"] } | { ok: false; status: 400 | 409; body: { error: string; priceChanges?: PriceChange[] } }>`

- [ ] **Step 1: Testes que falham** (`query.graph` falso, mesmo estilo de `checkout-payload.unit.spec.ts`):
  - `uses the database price and product title`: o cliente manda `price: 1, title: "X"`; o banco tem `amount: 7900` em brl e o produto "Cesto de palha". Com `price: 7900` vindo do cliente, o resultado é `ok: true` com `price: 7900` e `title: "Cesto de palha"`;
  - `title-only difference does not block`: o preço bate e o título é diferente; o resultado é `ok: true` com o título do banco;
  - `answers 409 listing only the changed variants`: 2 itens, 1 com preço divergente; o resultado é `status: 409`, `body.error === PRICE_CHANGED_MESSAGE` e `body.priceChanges` com um só elemento, `{ variantId, price: <banco>, title: <banco> }`;
  - `answers 400 when the variant is gone`: variante ausente no graph; o resultado é `status: 400` e `body.error === CART_ITEM_UNAVAILABLE_MESSAGE`, sem `variantId` no corpo;
  - `answers 400 when there is no brl price`: só preço em `usd`; 400 igual ao anterior;
  - `keeps duplicate variant lines`: a mesma variante em 2 linhas com quantidades 1 e 2; o resultado tem 2 linhas, cada uma com o preço do banco.

- [ ] **Step 2:** Rodar `npm run test:unit -- src/utils/__tests__/checkout-items.unit.spec.ts`. Esperado: FAIL ("Cannot find module").

- [ ] **Step 3: Implementar `resolveCheckoutItems`.** É uma única consulta: `query.graph({ entity: "product_variant", fields: ["id", "prices.amount", "prices.currency_code", "product.title"], filters: { id: <ids únicos> } })`. Mantém a ordem e as linhas recebidas. O `quantity`, o `variantId` e o `productId` do cliente seguem iguais.

- [ ] **Step 4:** Rodar o mesmo comando. Esperado: PASS.

- [ ] **Step 5: Commit** `feat(checkout): resolver preço e título dos itens no servidor`

### Task 3: Ligar a resolução em `preference` e `sandbox-cash`

**Files:**
- Modify: `BE/api/store/checkout/preference/route.ts`
- Modify: `BE/api/store/checkout/sandbox-cash/route.ts`
- Test: `BE/api/store/checkout/preference/__tests__/route.unit.spec.ts`
- Test: `BE/api/store/checkout/sandbox-cash/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `resolveCheckoutItems` (Task 2) e `recordSnapshot(..., initial)` (Task 1)
- Produces: a resposta 200 da `preference` ganha `total: number` (centavos, o `payload.total` do snapshot). O 409 de preço tem o corpo da Task 2.

- [ ] **Step 1: Testes que falham.** Ampliar o `graph` falso dos testes para responder também com `prices` e `product.title`.
  - preference `charges the database price, not the client's`: o cliente manda `price: 1`, o banco tem 7900. Esperado: 409 com `priceChanges`, sem chamar `resolveCheckoutShipping` nem `Preference.create`;
  - preference `uses database title and price in the MP items and snapshot`: o preço bate e o título é adulterado. Esperado: `Preference.create` recebe `title` do banco e `unit_price: 79`, e `recordSnapshot` recebe `items[0].title` do banco;
  - preference `returns total in cents`: `res._body.total === payload.total`;
  - preference `answers 400 for a variant without brl price` (sem chamar o frete);
  - sandbox-cash: 409 com preço adulterado e nenhum pedido criado; no caminho feliz, `recordSnapshot` é chamado com `{ status: "paid", ordersCreatedAt: expect.any(Date) }`.

- [ ] **Step 2:** Rodar `npm run test:unit -- src/api/store/checkout`. Esperado: FAIL nos testes novos.

- [ ] **Step 3: Implementar.** Nas duas rotas, logo depois do `safeParse`, chamar `resolveCheckoutItems(query, parsed.data.items)`. Se falhar, `return res.status(r.status).json(r.body)`. Se der certo, seguir com `{ ...parsed.data, items: r.items }` para `resolveCheckoutShipping`, `buildCheckoutSnapshot` e os `items` da preferência. A `preference` inclui `total: checkoutSnapshotPayload.total` na resposta.

- [ ] **Step 4:** Rodar o mesmo comando. Esperado: PASS, com os testes antigos das duas rotas ainda verdes.

- [ ] **Step 5: Commit** `fix(checkout): cobrar preço e título do banco na preferência e no pedido de teste`

### Task 4: Brick cobra o total do snapshot

**Files:**
- Modify: `BE/api/store/checkout/payment/route.ts`
- Test: `BE/api/store/checkout/payment/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `findByExternalReference` e `transitionFromPending` (Task 1)
- Produces: 404 `{ error: "Pedido não encontrado." }` e 409 `{ error: "Este pedido já foi pago." }`

- [ ] **Step 1: Testes que falham** (a rota passa a resolver `CHECKOUT_MODULE` e `logger` no `scope`):
  - `charges the snapshot total and ignores transaction_amount`: snapshot com `total: 10400`, cliente manda `transaction_amount: 0.01`. Esperado: `Payment.create` com `transaction_amount: 104`;
  - `accepts a body without transaction_amount`;
  - `404 when the snapshot does not exist`: sem chamar `Payment.create`;
  - `409 when the snapshot is paid` e `409 when it is amount_mismatch`: sem chamar `Payment.create`;
  - `marks paid when MP answers approved`: `transitionFromPending(ref, "paid", "123")`;
  - `does not mark on pending or rejected`: `transitionFromPending` não é chamado;
  - `still answers 200 if the transition loses`: `transitionFromPending` devolve `false`, a rota faz `logger.warn` e devolve o pagamento normalmente.

- [ ] **Step 2:** Rodar `npm run test:unit -- src/api/store/checkout/payment`. Esperado: FAIL.

- [ ] **Step 3: Implementar.** `transaction_amount` passa a `z.number().optional()` e não é lido. O valor cobrado é `snapshot.payload.total / 100`. A chave de idempotência continua `randomUUID()` por tentativa.

- [ ] **Step 4:** Rodar o mesmo comando. Esperado: PASS.

- [ ] **Step 5: Commit** `fix(checkout): cobrar no brick o total do snapshot e bloquear pedido já pago`

### Task 5: Webhook confere o valor e cria pedidos uma vez

**Files:**
- Modify: `BE/api/webhooks/mercadopago/route.ts`
- Test: `BE/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `findByExternalReference`, `transitionFromPending`, `claimOrderCreation` e `releaseOrderCreation` (Task 1)

- [ ] **Step 1: Testes que falham:**
  - `creates orders when the amount matches`: `total: 10400`, `transaction_amount: 104`. Esperado: `transitionFromPending(ref, "paid", id)`, `claimOrderCreation` e `createOrdersFromCheckout` chamados;
  - `does not treat float rounding as mismatch`: `total: 1010`, `transaction_amount: 10.1`. Esperado: pedidos criados;
  - `marks amount_mismatch and creates nothing`: `transaction_amount: 0.01`. Esperado: `transitionFromPending(ref, "amount_mismatch", id)`, `logger.error` contendo o ref, o payment id, `1` e `10400`, nenhum pedido e status 200;
  - `creates orders when the Brick already marked paid with the same payment id`: snapshot com `status: "paid"` e `paymentId` igual ao do webhook. Esperado: `transitionFromPending` não é chamado, `claimOrderCreation` é, e os pedidos são criados;
  - `skips silently when orders were already claimed`: `claimOrderCreation` devolve `false`. Esperado: nenhum pedido e nenhum `logger.error`;
  - `logs an extra payment and creates nothing`: snapshot `paid` com outro `paymentId`. Esperado: `logger.error` com os dois ids e os dois valores, e nenhum pedido;
  - `logs and blocks a correct payment on an amount_mismatch snapshot`;
  - `releases the claim when order creation throws`: `createOrdersFromCheckout` lança erro. Esperado: `releaseOrderCreation(ref)` e `logger.error`;
  - `legacy preference fallback without local snapshot`: compara com `meta.total`; se faltar `total`, `logger.error` e nenhum pedido.

- [ ] **Step 2:** Rodar `npm run test:unit -- src/api/webhooks/mercadopago`. Esperado: FAIL.

- [ ] **Step 3: Implementar.** Quando há `external_reference`, buscar **sempre** primeiro o snapshot local, em vez de usar `payment.metadata`. O fallback legado da busca de preferência só entra sem snapshot local. Para pagamento `approved` com snapshot local:

  ```
  paid = Math.round(transaction_amount * 100); expected = payload.total
  if status(null→pending) == pending:
      won = transitionFromPending(ref, paid == expected ? "paid" : "amount_mismatch", id)
      if !won: reload the snapshot and continue with the current state
      else if mismatch: logger.error(mismatch); 200
  if status == amount_mismatch: logger.error(blocked); 200
  if paymentId != id: logger.error(extra payment); 200
  if !claimOrderCreation(ref): 200
  try createOrdersFromCheckout + emit as today
  catch: releaseOrderCreation(ref); logger.error; 200
  ```

  Sem snapshot local (preferência legada): se `meta.total` não for número ou não bater, `logger.error` e 200; senão, segue o fluxo atual (idempotente por `createOrdersFromCheckout`).

- [ ] **Step 4:** Rodar o mesmo comando e depois a suíte inteira (`npm run test:unit`). Esperado: PASS.

- [ ] **Step 5: Commit** `fix(webhook): criar pedidos só quando o valor pago bate com o snapshot`

### Task 6: Vitrine trata o 409 de preço e usa o total do servidor no Brick

**Files:**
- Modify: `SF/lib/cart-store.ts`
- Modify: `SF/app/checkout/create-preference.ts`
- Modify: `SF/app/checkout/page.tsx`
- Modify: `SF/components/payment/MercadoPagoBrick.tsx`
- Test: `SF/app/checkout/__tests__/create-preference.test.ts`, `SF/app/checkout/__tests__/shipping-step.test.tsx` (ou o teste da etapa de envio que já cobre o 409 de frete) e o teste existente do `cart-store`, se houver (senão, `SF/lib/__tests__/cart-store.test.ts`)

**Interfaces:**
- Consumes: o corpo do 409 de preço (Task 2) e `total` da `preference` (Task 3)
- Produces:
  - `applyPriceChanges(changes: Array<{ variantId: string; price: number; title: string }>): void` no `CartStore`
  - `CheckoutResult` falho ganha `priceChanges?: PriceChange[]`
  - `PreferenceData` ganha `totalCents: number`
  - `submitPayment(paymentFields, externalReference)`, sem o terceiro argumento

- [ ] **Step 1: Testes que falham:**
  - `readCheckoutResponse` com 409 `{ error, priceChanges }`: o resultado tem `priceChanges` preenchido;
  - `createPreference` mapeia `total` para `totalCents`;
  - `applyPriceChanges`: atualiza `price` e `title` só das variantes listadas, sem mexer em `variantTitle` e `quantity`;
  - etapa de envio: depois de um 409 com `priceChanges`, o carrinho tem o preço novo, a mensagem "O preço de alguns produtos foi atualizado. Confira e continue." aparece e a etapa continua em envio;
  - `submitPayment` não envia `transaction_amount` no corpo.

- [ ] **Step 2:** Rodar `pnpm vitest run src/app/checkout src/lib`. Esperado: FAIL.

- [ ] **Step 3: Implementar.** Em `page.tsx`, o ramo `409 && priceChanges` vem antes do ramo de frete (`409 && quote`). O Brick recebe `amountCents={preferenceData.totalCents}`.

- [ ] **Step 4:** Rodar `pnpm vitest run` e `pnpm tsc --noEmit` em `apps/storefront`. Esperado: tudo verde.

- [ ] **Step 5: Commit** `feat(checkout): atualizar preço no carrinho após 409 e usar total do servidor no brick`

### Task 7: Verificação final

- [ ] **Step 1:** Rodar `npm run test:unit` e `npm run test:admin` no backend, e `pnpm vitest run` e `pnpm tsc --noEmit` na vitrine. Esperado: tudo verde. Comparar a contagem de testes com a do #63 (664 unitários no backend, 145 na vitrine).
- [ ] **Step 2:** Atualizar o HANDOFF.md com o estado e o checklist de deploy:
  - rodar as migrations `checkout` e `seller` com `docker compose run` na imagem nova, antes de subir o container;
  - configurar `MELHOR_ENVIO_TOKEN`;
  - subir backend e vitrine juntos.
- [ ] **Step 3: Commit** `docs(checkout): registrar verificação e checklist de deploy`

O teste ponta a ponta no servidor de teste (preço adulterado no DevTools → 409; checkout normal aprovado pelo webhook) fica para depois do merge em `develop`, junto com o deploy do #63.
