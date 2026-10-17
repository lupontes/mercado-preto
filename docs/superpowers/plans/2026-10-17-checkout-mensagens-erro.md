# Mensagens de Erro do Checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cartão recusado mantém o carrinho e mostra o motivo em português. Erros do Mercado Pago chegam ao navegador só como mensagem amigável. Um 422 de frete com uma única opção restante já a deixa selecionada.

**Architecture:** Um módulo puro de tradução (`utils/mercadopago-messages.ts`) é usado pela rota `POST /store/checkout/payment`. A vitrine passa a tratar `status: "rejected"` como erro em `submitPayment`, e assim `onSuccess` (que esvazia o carrinho) nunca roda numa recusa. O ramo 422 de `page.tsx` ganha a pré-seleção.

**Tech Stack:** Medusa v2 backend (Jest), Next.js vitrine (Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-17-checkout-mensagens-erro-design.md`

## Global Constraints

- Código, identificadores e comentários em inglês; textos para o comprador em pt-BR, **exatamente** como na tabela do spec.
- Mensagem padrão de recusa: `O pagamento não foi aprovado. Tente outro cartão ou pague com Pix.`
- Mensagem padrão de erro da API: `Não foi possível processar o pagamento. Tente novamente em instantes.`
- Código 2034: `Não foi possível usar este e-mail no pagamento. Confira o e-mail ou use outro.`
- 422 com opção única: `As opções de frete mudaram. Confira e continue.`
- Exceção do Mercado Pago → **502**, sem campo `detail`.
- Medusa `logger.error` aceita no máximo 2 argumentos; juntar tudo numa string.
- Backend: **npm** (`cd packages/medusa-backend/apps/backend && npm run test:unit -- <path>`), e `npx tsc --noEmit -p .` antes do commit. Vitrine: **pnpm** (`cd apps/storefront && pnpm vitest run <path>`), e `pnpm tsc --noEmit`.
- Commits em Conventional Commits, descrição em pt-BR, com o trailer da sessão.

## Review Focus

- **Erro do SDK sem `cause`, com `cause` vazio ou não-array, ou um valor que não é `Error`** (o SDK do MP às vezes rejeita com objeto puro): cai na mensagem padrão, sem lançar (Task 1).
- **`code` como string (`"2034"`) ou número (`2034`)**: os dois traduzem (Task 1).
- **`status_detail` ausente numa recusa**: mensagem padrão (Task 1).
- **`pending` e `in_process`** (Pix e cartão em análise) não lançam em `submitPayment`; o carrinho continua sendo esvaziado como hoje (Task 2).
- **422 com uma opção, mas com loja indisponível**: não pré-seleciona; mantém o comportamento atual (Task 3).

---

### Task 1: Traduzir as respostas do Mercado Pago na rota de pagamento

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/mercadopago-messages.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/mercadopago-messages.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/store/checkout/payment/route.ts` (o `res.json` final e o `catch`)
- Test: `packages/medusa-backend/apps/backend/src/api/store/checkout/payment/__tests__/route.unit.spec.ts`

**Interfaces:**
- Produces:
  - `rejectionMessage(statusDetail: string | null | undefined): string`
  - `paymentErrorMessage(err: unknown): string` — lê `err.cause` quando é array e usa o primeiro `code` conhecido (comparado como string).
  - Resposta de recusa: `{ payment_id, status: "rejected", status_detail, point_of_interaction, message }`. Para os outros status, `message` não aparece.

- [ ] **Step 1: Testes que falham, em `mercadopago-messages.unit.spec.ts`:**
  - `it.each` sobre as 11 linhas da tabela do spec (`cc_rejected_high_risk` e `cc_rejected_blacklist` como linhas separadas): `rejectionMessage(detail)` igual ao texto do spec;
  - `rejectionMessage("cc_rejected_something_new")`, `rejectionMessage(undefined)` e `rejectionMessage(null)` dão a mensagem padrão de recusa;
  - `paymentErrorMessage({ message: "x", cause: [{ code: 2034 }] })` e `{ cause: [{ code: "2034" }] }` dão a mensagem do 2034;
  - `paymentErrorMessage(new Error("boom"))`, `paymentErrorMessage({ cause: [] })`, `paymentErrorMessage({ cause: "nope" })`, `paymentErrorMessage(null)` e `{ cause: [{ code: 9999 }] }` dão a mensagem padrão de erro.

- [ ] **Step 2: Testes que falham, na rota** (usando `mockPaymentCreate`, `checkoutService` e o logger já mockados no arquivo):
  - substituir `returns 500 when the MP SDK throws` por `answers 502 with a friendly message and no detail when the MP SDK throws`: `mockRejectedValue(new Error("card rejected"))` → status 502, body igual a `{ error: "Não foi possível processar o pagamento. Tente novamente em instantes." }` (`toEqual`, para provar que não há `detail`), e `logger.error` chamado uma vez, com a string contendo `card rejected` e no máximo 2 argumentos;
  - `translates MP error 2034`: rejeita com `{ message: "Invalid users involved", cause: [{ code: 2034 }] }` → 502 com a mensagem do 2034;
  - estender `handles rejected card payment status`: com `status_detail: "cc_rejected_insufficient_amount"`, o body tem `message: "Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix."` e `checkoutService.transitionFromPending` não é chamado;
  - em `returns payment_id and status for an approved card payment`, conferir que o body não tem `message`.

- [ ] **Step 3:** Rodar `npm run test:unit -- src/utils/__tests__/mercadopago-messages.unit.spec.ts src/api/store/checkout/payment`. Esperado: FAIL (módulo inexistente; 500 em vez de 502; `message` ausente).

- [ ] **Step 4: Implementar.** Duas tabelas `Record<string, string>` com as constantes padrão exportadas. Na rota: `...(payment.status === "rejected" ? { message: rejectionMessage(payment.status_detail) } : {})` no `res.json`. No `catch`: `logger.error` com `[checkout/payment] falha no Mercado Pago para ${external_reference}: <mensagem bruta>` (para objeto não-`Error`, `JSON.stringify`) e `res.status(502).json({ error: paymentErrorMessage(err) })`.

- [ ] **Step 5:** Rodar o comando do Step 3, depois `npm run test:unit` inteiro e `npx tsc --noEmit -p .`. Esperado: tudo verde e 0 erros de tipo.

- [ ] **Step 6: Commit** `fix(checkout): traduzir recusas e erros do mercado pago para o comprador`

### Task 2: Manter o carrinho quando o cartão é recusado

**Files:**
- Modify: `apps/storefront/src/components/payment/MercadoPagoBrick.tsx` (`submitPayment`, linhas 14-38)
- Test: `apps/storefront/src/components/payment/__tests__/MercadoPagoBrick.test.ts`

**Interfaces:**
- Consumes: os campos `status` e `message` da resposta da Task 1.
- Produces: `submitPayment` lança `Error` em resposta não-OK e em `status === "rejected"`. Só retorna nos outros casos, e só então `handleSubmit` chama `onSuccess`, que esvazia o carrinho em `page.tsx`. Por isso `page.tsx` não muda nesta task.

- [ ] **Step 1: Testes que falham** (mesmo `fetch` mockado do arquivo):
  - `throws the translated reason when the card is rejected`: 200 com `{ payment_id: 1, status: "rejected", status_detail: "cc_rejected_insufficient_amount", message: "Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix." }` → `rejects.toThrow("Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix.")`;
  - `throws the default reason when a rejection has no message`: 200 com `{ status: "rejected" }` → `rejects.toThrow("O pagamento não foi aprovado. Tente outro cartão ou pague com Pix.")`, para o caso de um backend antigo no meio do deploy;
  - `it.each(["approved", "pending", "in_process"])` `resolves for %s`: resolve com o `payment_id`.

- [ ] **Step 2:** Rodar `pnpm vitest run src/components/payment/__tests__/MercadoPagoBrick.test.ts`. Esperado: FAIL nos testes de recusa.

- [ ] **Step 3: Implementar** a checagem de `data.status === "rejected"` depois do `!res.ok`, com a mensagem padrão como fallback. Ajustar o tipo de retorno para incluir `status`.

- [ ] **Step 4:** Rodar `pnpm vitest run` e `pnpm tsc --noEmit` em `apps/storefront`. Esperado: tudo verde.

- [ ] **Step 5: Commit** `fix(checkout): manter o carrinho quando o cartão é recusado`

### Task 3: Pré-selecionar a única opção de frete restante no 422

**Files:**
- Modify: `apps/storefront/src/app/checkout/page.tsx` (ramo `result.status === 422`, linhas 169-172)
- Test: `apps/storefront/src/app/checkout/__tests__/checkout-test-cash.test.tsx` (já tem o harness da página e os testes de 409 da preferência; seguir o mesmo estilo)

**Interfaces:**
- Consumes: `ShippingQuote` de `@/lib/cart-store` (`options`, `unavailableSellers`).

- [ ] **Step 1: Testes que falham** (preferência mockada respondendo `{ ok: false, status: 422, error: "Opção de frete indisponível", quote }`):
  - `preselects the only remaining shipping option after a 422`: `quote` com uma opção (`rapido`) e `unavailableSellers: []` → o radio `Rápido` fica marcado, aparece `As opções de frete mudaram. Confira e continue.` e a página continua na etapa de frete;
  - `keeps the buyer choosing when a 422 leaves two options`: duas opções → nenhum radio marcado e aparece `Opção de frete indisponível`;
  - `does not preselect when a store became unavailable`: uma opção e uma loja em `unavailableSellers` → nenhum radio marcado e aparece `Opção de frete indisponível`.

- [ ] **Step 2:** Rodar `pnpm vitest run src/app/checkout/__tests__/checkout-test-cash.test.tsx`. Esperado: FAIL no primeiro teste.

- [ ] **Step 3: Implementar** no ramo 422: se `options.length === 1 && unavailableSellers.length === 0`, `setShipping(options[0])` e a mensagem nova; senão, como hoje.

- [ ] **Step 4:** Rodar `pnpm vitest run` e `pnpm tsc --noEmit` em `apps/storefront`. Esperado: tudo verde.

- [ ] **Step 5: Commit** `fix(checkout): pré-selecionar a única opção de frete que sobrou`
