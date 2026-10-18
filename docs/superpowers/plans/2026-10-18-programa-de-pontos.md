# Programa de Pontos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O comprador, identificado pelo CPF/CNPJ e confirmado por um código no e-mail, acumula pontos nas compras pagas e os usa como desconto, pago pela plataforma, numa compra seguinte.

**Architecture:**
- **Módulo `loyalty`:** guarda lançamentos (`loyalty_entry`) e códigos (`loyalty_code`). O saldo é sempre uma soma, e a reserva usa um advisory lock por documento.
- **Rotas `/store/loyalty/code|verify`:** emitem um JWT de escopo `loyalty`.
- **Checkout:** o `preference` valida o token, aplica o teto (comissão), reparte o desconto entre as lojas e reserva os pontos.
- **Webhook:** confirma o resgate e credita os pontos depois de criar os pedidos.
- **Comissão:** ganha `loyaltyDiscount`, e o relatório mostra o desconto.
- **Vitrine:** um bloco "Usar meus pontos" na etapa de entrega.

**Tech Stack:** Medusa v2 (Jest, `moduleIntegrationTestRunner` com Postgres real), Next.js (Vitest).

**Spec:** `docs/superpowers/specs/2026-10-17-programa-de-pontos-design.md`

## Global Constraints

- **Constantes**, em `modules/loyalty/constants.ts`:
  - `POINTS_PER_REAL = 1`;
  - `CENTS_PER_POINT = 1`;
  - `RESERVATION_TTL_MINUTES = 120`;
  - `CODE_TTL_MINUTES = 10`;
  - `CODE_MAX_ATTEMPTS = 5`;
  - `LOYALTY_TOKEN_TTL_SECONDS = 1800`.
- **Pontos ganhos:** `Math.floor((itensEmCentavos − descontoEmCentavos) / 100) * POINTS_PER_REAL`, sem contar o frete.
- **Teto do desconto:** `Math.floor(itensEmCentavos × taxaDeComissão / 100)`, com a taxa lida de `commissionService.getCommissionRate()`.
- **Mensagens**, exatamente:
  - pedido de código, sempre 200: `Se houver compras com este documento, enviamos um código para o e-mail usado nelas.`
  - código errado ou expirado, 400: `Código inválido ou expirado.`
  - token inválido no checkout, 401: `Confirme seus pontos novamente.`
  - saldo insuficiente, 400: `Saldo de pontos insuficiente.`
- **Token:** JWT assinado com `JWT_SECRET`, com payload `{ scope: "loyalty", document }` e validade de 30 minutos. O token nunca vai para o log nem para o `localStorage`.
- **Tamanho do código e do log:** o código tem 6 dígitos, gerado com `crypto.randomInt`. Só o `sha256` dele vai para o banco, e ele nunca vai para o log.
- **Backend:**
  - `npm run test:unit -- <path>`;
  - testes de módulo com `DB_HOST=localhost DB_PORT=5433 DB_USERNAME=medusa DB_PASSWORD=medusa npm run test:integration:modules -- <path>`, com o Postgres de `infra/docker-compose.yml` no ar;
  - `npx tsc --noEmit -p .` antes de cada commit.
- **Vitrine:** `npx vitest run` e `npx tsc --noEmit`. **Nunca `pnpm`**, porque ele reinstala o backend.
- Código e comentários em inglês; textos em pt-BR. Commits em Conventional Commits, em pt-BR, com o trailer da sessão.

## Review Focus

- **Duas reservas simultâneas do mesmo documento:** a soma nunca passa do saldo (Task 1, Postgres real).
- **Reserva vencida e reserva confirmada:** a vencida volta para o saldo; a confirmada nunca volta (Task 1).
- **Token de um CPF usado no checkout de outro:** 401 (Task 3).
- **Desconto maior que o teto:** usa o teto e devolve `pointsApplied` (Task 3).
- **Webhook entregue duas vezes:** não credita nem confirma de novo (Task 4).

---

### Task 1: Módulo `loyalty`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/modules/loyalty/{index.ts,service.ts,constants.ts,models/loyalty-entry.ts,models/loyalty-code.ts}` e a migration, gerada com `npx medusa db:generate loyalty`
- Modify: `packages/medusa-backend/apps/backend/medusa-config.ts`, para registrar o módulo
- Test: `packages/medusa-backend/apps/backend/src/modules/loyalty/__tests__/service.integration.spec.ts`

**Interfaces:**
- **Produces:**
  - `LOYALTY_MODULE = "loyalty"`;
  - `availableBalance(document: string): Promise<number>`;
  - `earn(document: string, externalReference: string, points: number): Promise<boolean>`. Devolve `false` se o crédito já existe;
  - `reserve(document: string, externalReference: string, points: number): Promise<boolean>`. Devolve `false` se o saldo não bastar;
  - `cancelReservation(externalReference: string): Promise<void>`;
  - `confirmRedemption(externalReference: string): Promise<boolean>`. Faz `reserve` virar `redeem` e devolve `true` uma única vez;
  - `issueCode(document: string): Promise<string>`. Devolve o código cru e invalida os anteriores;
  - `verifyCode(document: string, code: string): Promise<boolean>`.
- **Modelos:**
  - `loyalty_entry`: `id`, `buyerDocument` (com índice), `type` (`earn`, `reserve` ou `redeem`), `points` (inteiro com sinal), `externalReference` (pode ser nulo) e índice único em (`type`, `externalReference`);
  - `loyalty_code`: `id`, `buyerDocument`, `codeHash`, `expiresAt`, `attempts` (inteiro, padrão 0) e `usedAt` (pode ser nulo).
- **Saldo:**
  - SQL: `sum(points) where buyerDocument = ? and deleted_at is null and (type <> 'reserve' or created_at > now() - interval '<TTL> minutes')`;
  - `reserve` roda em transação: `pg_advisory_xact_lock(hashtext(document))`, calcula o saldo e insere só se `points <= saldo`.

- [ ] **Step 1: Testes que falham** (Postgres real, no estilo de `modules/checkout/__tests__/service.integration.spec.ts`):
  - **saldo:** `earn(doc,"r1",100)` → saldo 100; `earn(doc,"r1",100)` de novo devolve `false`, e o saldo continua 100;
  - **reserva:**
    - `reserve(doc,"r2",30)` → saldo 70;
    - `reserve` acima do saldo → `false`;
    - `cancelReservation("r2")` → saldo 100;
    - `confirmRedemption("r2")` → `true`, e de novo → `false`. O saldo fica 70 e **não** volta quando o tempo passa;
  - **vencimento:** uma reserva com `created_at` antigo, ajustado por SQL no teste, não conta no saldo;
  - **concorrência:** 5 `reserve(doc, refN, 60)` simultâneos sobre um saldo de 100 → exatamente 1 `true`;
  - **código:**
    - `issueCode` devolve 6 dígitos;
    - `verifyCode` certo → `true` uma vez só;
    - errado 5 vezes → até o código certo passa a falhar;
    - expirado → `false`;
    - um código novo invalida o anterior;
    - o banco guarda só o hash.
- [ ] **Step 2:** Rodar os testes de módulo. Esperado: FAIL.
- [ ] **Step 3: Implementar**, com `@InjectManager`, `@InjectTransactionManager` e `manager.execute`, como nos módulos `checkout` e `seller`.
- [ ] **Step 4:** Rodar os testes de módulo, `npm run test:unit` e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `feat(pontos): adicionar o módulo de pontos com saldo, reserva e código`

### Task 2: Código por e-mail e token

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/loyalty-token.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/store/loyalty/code/route.ts` e `verify/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/modules/checkout/service.ts`, que ganha `findLatestPaidEmail(document: string): Promise<string | null>`
- Modify: `packages/medusa-backend/apps/backend/src/api/middlewares.ts`, que ganha o limite de 10 pedidos a cada 15 minutos por IP nas duas rotas, com `rateLimitKeyGenerator`
- Test: `utils/__tests__/loyalty-token.unit.spec.ts` e `api/store/loyalty/__tests__/{code,verify}.unit.spec.ts`

**Interfaces:**
- Produces:
  - `signLoyaltyToken(document: string): string`;
  - `verifyLoyaltyToken(token: string): { document: string } | null`. Recusa um token de outro escopo, como o de vendedor;
  - `findLatestPaidEmail` lê `payload->'address'->>'email'` do snapshot `status = 'paid'` mais recente com `payload->>'buyer_document' = ?`.

- [ ] **Step 1: Testes que falham:**
  - **token:** ida e volta funciona; um token expirado, adulterado ou com `scope: "seller"` dá `null`;
  - **code:**
    - documento inválido → 400;
    - CPF sem compra paga → 200 com a mensagem genérica e sem e-mail;
    - CPF com compra → mesma resposta, `issueCode` chamado e o `sendBrevoEmail` mockado recebe o e-mail da compra com o código no HTML;
    - o código não vai para o log;
  - **verify:**
    - código certo → 200 `{ token, balance }`, e o `token` passa em `verifyLoyaltyToken` com o documento normalizado;
    - código errado → 400 com a mensagem.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar.** O documento é validado e normalizado com `validateDocument`, como no checkout.
- [ ] **Step 4:** Rodar, a suíte e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `feat(pontos): confirmar o comprador por código no e-mail`

### Task 3: Resgate no checkout

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/loyalty-discount.ts`
- Modify: `packages/medusa-backend/apps/backend/src/utils/checkout-payload.ts` (schema e tipos) e `api/store/checkout/preference/route.ts`
- Test: `utils/__tests__/loyalty-discount.unit.spec.ts` e `api/store/checkout/preference/__tests__/loyalty.unit.spec.ts`

**Interfaces:**
- **Produces:**
  - `allocateLoyaltyDiscount(groups: Array<{ sellerId: string; itemsTotal: number }>, discount: number): Record<string, number>`. A divisão é proporcional, os centavos que sobram vão para o primeiro grupo e a soma bate com o desconto;
  - `loyaltyDiscountCap(itemsTotal: number, commissionRate: number): number`.
- **No snapshot:**
  - `loyalty_points` e `loyalty_discount` no nível do checkout;
  - `loyalty_discount` em cada `seller_group`;
  - o `total` já com o desconto.
- **Resposta:** ganha `pointsApplied` e `discount`.

- [ ] **Step 1: Testes que falham:**
  - **repartição:**
    - (10000, 5000) com 101 → (68, 33) ou o arredondamento definido, somando 101;
    - um grupo só fica com tudo;
    - desconto 0 → todos 0;
  - **teto:** 10000 a 10% → 1000;
  - **rota:**
    - `redeemPoints` sem `loyaltyToken` → 401;
    - token de outro documento → 401;
    - saldo 50 e pedido 80 → 400;
    - pedido acima do teto → usa o teto, `pointsApplied` = teto e `reserve` é chamado com o teto;
    - o `total` do snapshot é `itens + frete − desconto`;
    - a soma das partes por grupo é o desconto;
    - `reserve` devolvendo `false` (corrida) → 400 de saldo insuficiente;
    - a criação da preferência falha → `cancelReservation(ref)` é chamado;
    - com desconto, a preferência vai com **um único item** `Pedido Mercado Preto` de `unit_price = total/100`, porque o Mercado Pago não aceita item negativo;
    - sem `redeemPoints`, a rota se comporta exatamente como hoje.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar.** A reserva vem **depois** de gravar o snapshot e **antes** de criar a preferência.
- [ ] **Step 4:** Rodar, a suíte inteira (inclusive os testes existentes do `preference`) e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `feat(pontos): usar pontos como desconto no checkout`

### Task 4: Webhook — confirmar o resgate e creditar

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts` e `utils/create-orders-from-checkout.ts`, que passa `loyalty_discount` do grupo para o `metadata` do pedido
- Test: `api/webhooks/mercadopago/__tests__/loyalty.unit.spec.ts` e o teste de `create-orders-from-checkout`

- [ ] **Step 1: Testes que falham:**
  - depois de criar os pedidos com sucesso, `confirmRedemption(ref)` é chamado;
  - `earn(buyer_document, ref, floor((itens − desconto)/100))` também é chamado;
  - uma falha de `earn` ou de `confirmRedemption` vai para o log e não muda o 200;
  - uma notificação já reivindicada não chama nenhum dos dois;
  - os pedidos criados têm `metadata.loyalty_discount` igual à parte do grupo, ou 0.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar**, logo depois de `createOrders` e antes de `emitOrderEvents`.
- [ ] **Step 4:** Rodar, a suíte e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `feat(pontos): creditar pontos e confirmar o resgate no pagamento aprovado`

### Task 5: Comissão e relatório

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/modules/commission/models/commission.ts`, com `loyaltyDiscount: model.bigNumber().default(0)` e a migration gerada
- Modify: `packages/medusa-backend/apps/backend/src/modules/commission/service.ts` (`CalculateInput.loyaltyDiscount?`) e `subscribers/commission-on-payment.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/reports/route.ts`
- Test: os testes existentes de `commission` e do subscriber, mais o de `reports`

- [ ] **Step 1: Testes que falham:**
  - `calculate({..., loyaltyDiscount: 300})` mantém `sellerPayout` igual ao cálculo sem desconto, e grava `loyaltyDiscount: 300`;
  - o subscriber lê `order.metadata.loyalty_discount`;
  - o relatório ganha `summary.totalLoyaltyDiscount`, além de `loyaltyDiscount` por loja.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Conferir os efeitos de `bigNumber` com `default` no modelo.
- [ ] **Step 4:** Rodar, a suíte, os testes de módulo de `commission` (se existirem) e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `feat(pontos): registrar na comissão o desconto pago pela plataforma`

### Task 6: Vitrine

**Files:**
- Create: `apps/storefront/src/lib/loyalty-api.ts` e `apps/storefront/src/app/checkout/LoyaltyRedeem.tsx`
- Modify: `apps/storefront/src/app/checkout/create-preference.ts`, que aceita `{ redeemPoints, loyaltyToken }` opcionais e devolve `pointsApplied` e `discount`
- Modify: `apps/storefront/src/app/checkout/page.tsx` (bloco na etapa de entrega, resumo com o desconto e a passagem dos pontos ganhos para o sucesso) e `app/checkout/sucesso/page.tsx`
- Test: `apps/storefront/src/lib/__tests__/loyalty-api.test.ts`, `apps/storefront/src/app/checkout/__tests__/loyalty-redeem.test.tsx` e um caso em `checkout-test-cash.test.tsx`

**Interfaces:**
- Produces:
  - `requestLoyaltyCode(document): Promise<string>`;
  - `verifyLoyaltyCode(document, code): Promise<{ token: string; balance: number }>`;
  - `LoyaltyRedeem({ document, maxDiscountCents, onChange })`. O `onChange` recebe `{ redeemPoints, loyaltyToken } | null`.

- [ ] **Step 1: Testes que falham:**
  - **API:** as duas funções postam nas rotas certas, com a chave pública, e lançam a mensagem do backend;
  - **componente:**
    - "Enviar código" chama `requestLoyaltyCode` e mostra o campo do código;
    - verificar mostra "Saldo: R$ X,XX" e o botão "Usar R$ Y,YY", com Y = min(saldo, teto);
    - usar chama `onChange` com os pontos e o token;
    - o token não vai para o `localStorage`;
  - **página:**
    - com pontos aplicados, `createPreference` recebe `redeemPoints` e `loyaltyToken`;
    - o resumo mostra "Desconto em pontos −R$ X" e o total do servidor;
    - depois do pagamento aprovado, a URL de sucesso leva `pontos=N`, com N = floor((itens − desconto)/100);
  - **sucesso:** com `pontos=N`, mostra "Você ganhou N pontos".
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar.** O teto vem do servidor: `createPreference` já devolve `pointsApplied`. Antes disso, o componente mostra o saldo inteiro, e a vitrine exibe o valor realmente aplicado que volta do servidor.
- [ ] **Step 4:** Rodar `npx vitest run` e `npx tsc --noEmit`. Esperado: verde.
- [ ] **Step 5: Commit** `feat(pontos): usar pontos no checkout da vitrine`

### Task 7: Ponta a ponta no servidor de teste (depois do merge e do deploy)

Sem arquivos novos. O crédito acontece no webhook do Mercado Pago, que não alcança um backend local, por isso o teste é no servidor:

1. Deploy, com `db:migrate` antes de subir o backend, por causa das tabelas `loyalty_*` e da coluna nova em `commission`.
2. **Compra A:** cartão sandbox pela vitrine local, com o túnel para o backend do servidor, como no teste do #69. Conferir o `earn` no banco.
3. **Compra B:** pedir o código. O e-mail vai para o `TEST_EMAIL_RECIPIENT` do usuário, que lê e informa o código. Não emitir código pelo servidor.
4. Verificar o código, usar os pontos e pagar. Conferir no banco:
   - o `redeem` confirmado;
   - o `earn` da compra B;
   - o `loyaltyDiscount` na comissão;
   - o `sellerPayout` igual ao de uma compra sem desconto;
   - o Mercado Pago cobrou o total com desconto.
5. Registrar o resultado.

**Fora deste ciclo:** o pagamento de teste em dinheiro (`sandbox-cash`) não credita nem resgata pontos. Isso fica registrado como ruling.
