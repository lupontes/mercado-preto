# Frete Econômico com Loja Local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As opções de frete deixam de sumir quando uma loja não tem PAC. O Econômico usa o serviço mais barato de cada loja, o Rápido usa o mais rápido, e as duas viram uma só quando ficam idênticas.

**Architecture:** Só a montagem das opções em `quoteShipping` muda: a busca do serviço por nome dá lugar a um seletor por critério, e no fim entra uma checagem de opções idênticas. A vitrine passa a mostrar o serviço de cada loja no "ver detalhes".

**Tech Stack:** Medusa v2 backend (Jest), Next.js vitrine (Vitest).

**Spec:** `docs/superpowers/specs/2026-10-17-frete-economico-loja-local-design.md`

## Global Constraints

- Código, identificadores e comentários em inglês; textos para o comprador em pt-BR.
- Commits em Conventional Commits, com descrição em pt-BR, e com o trailer de co-autoria da sessão.
- Backend usa **npm** (`cd packages/medusa-backend/apps/backend && npm run test:unit -- <path>`); vitrine usa **pnpm** (`cd apps/storefront && pnpm vitest run <path>`).
- Econômico: menor `price`; em empate, menor `deliveryDays`. Rápido: menor `deliveryDays`; em empate, menor `price`.
- Opções idênticas (mesmo `service` em todas as lojas nas duas opções) → devolver só `rapido`.
- O total e o prazo de cada opção não mudam de fórmula: soma dos preços e maior prazo mais `handlingDays`.
- Rodar `npx tsc --noEmit -p .` no backend antes do commit. O build Docker já quebrou por erro de tipo que os testes unitários não pegam.

## Review Focus

- **Loja só com PAC** (sem SEDEX): o Rápido dessa loja passa a ser PAC, e o Econômico e o Rápido do carrinho continuam aparecendo (Task 1).
- **Uma loja só, local:** a resposta tem só `rapido`, como antes. A vitrine e o checkout já dependem disso (Task 1).
- **Opções que diferem só no preço de uma loja** não são idênticas; a comparação é por `service` (Task 1).
- **Checkout com `tier: "economico"` quando só sobrou `rapido`:** `resolveCheckoutShipping` responde 422 "Opção de frete indisponível", como já faz hoje. Sem mudança, mas o teste existente deve continuar verde (Task 1).
- **"ver detalhes" com 2 lojas e serviços diferentes** mostra o serviço certo de cada uma (Task 2).

---

### Task 1: Montar as opções pelo serviço mais barato e mais rápido de cada loja

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/utils/shipping-quote.ts` (constante `TIERS` e o laço que monta `options`, em torno das linhas 68-71 e 226-245)
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/shipping-quote.unit.spec.ts`

**Interfaces:**
- Produces: `quoteShipping` mantém a assinatura e o formato de `ShippingQuote`. Cada `SellerShipping` em `option.sellers` continua carregando `service`, `serviceId`, `price` e `deliveryDays` do serviço escolhido.

- [ ] **Step 1: Testes que falham** (mesmo estilo de `makeCalculator` e `makeQuery` do arquivo). Nos exemplos abaixo, a Loja A tem origem `40026010`:
  - `uses SEDEX in Econômico for a seller without PAC and keeps PAC for the others`: o calculator dá só SEDEX para a Loja A (2000, 2 dias) e PAC (3000, 9) e SEDEX (6000, 4) para a Loja B. Esperado: duas opções. Econômico com `sellers` `[A: SEDEX 2000, B: PAC 3000]` e `total` 5000. Rápido com `[A: SEDEX 2000, B: SEDEX 6000]` e `total` 8000;
  - `returns only Rápido when both options would be identical`: carrinho só com a Loja A, que tem só SEDEX. Esperado: `quote.options.map(o => o.tier)` igual a `["rapido"]`;
  - `uses the cheaper service in Econômico even when it is SEDEX`: Loja A com PAC 5000/9 e SEDEX 4000/3. Esperado: Econômico com A em SEDEX e, como as opções ficam idênticas no carrinho de uma loja, só `rapido`. Fazer o mesmo com 2 lojas para ver o Econômico com A em SEDEX e B em PAC;
  - `breaks ties by deadline in Econômico and by price in Rápido`: Loja A com dois serviços de preço igual (PAC 3000/9, SEDEX 3000/3) e Loja B com prazo igual (PAC 2000/4, SEDEX 5000/4). Com os desempates certos, as duas opções escolhem A=SEDEX e B=PAC, ficam idênticas e sobra só `rapido`, com `sellers` `[A: SEDEX, B: PAC]`. Um desempate errado em qualquer critério deixaria duas opções, e o teste falharia;
  - substituir `omits a tier when any seller lacks that service` por `keeps both tiers when a seller lacks SEDEX`: Loja A só com PAC. Esperado: Econômico e Rápido presentes, com A em PAC nos dois.

- [ ] **Step 2:** Rodar `npm run test:unit -- src/utils/__tests__/shipping-quote.unit.spec.ts`. Esperado: FAIL nos testes novos.

- [ ] **Step 3: Implementar.** `TIERS` passa a carregar, em vez de `service`, uma função `pick(quotes: ServiceQuote[]): ServiceQuote` com o critério e o desempate da Global Constraints. A montagem usa `pick(quotes)` para cada loja cotada; toda loja em `quotedSellers` tem ao menos um serviço, porque lista vazia já vira `quote_failed`. Depois de montar as duas opções, se o `service` de cada loja for igual nas duas, devolver só a de `tier: "rapido"`, com um comentário curto explicando o porquê.

- [ ] **Step 4:** Rodar o arquivo de teste. Depois rodar a suíte `npm run test:unit` inteira, que inclui `checkout-shipping` e as rotas de checkout, e `npx tsc --noEmit -p .`. Esperado: tudo verde e 0 erros de tipo.

- [ ] **Step 5: Commit** `fix(frete): usar o serviço mais barato e o mais rápido de cada loja nas opções`

### Task 2: Mostrar o serviço de cada loja no "ver detalhes"

**Files:**
- Modify: `apps/storefront/src/app/checkout/ShippingOptions.tsx` (lista de `selected.sellers`, em torno das linhas 72-77)
- Test: `apps/storefront/src/app/checkout/__tests__/shipping-options.test.tsx`

**Interfaces:**
- Consumes: `SellerShipping.service` (`'PAC' | 'SEDEX'`), que já existe em `SF/lib/cart-store.ts`.

- [ ] **Step 1: Teste que falha.** Uma cotação com 2 lojas, Loja A em SEDEX e Loja B em PAC, com "ver detalhes" aberto. O texto deve mostrar `Loja A — SEDEX` e `Loja B — PAC`, com o preço formatado de cada uma.
- [ ] **Step 2:** Rodar `pnpm vitest run src/app/checkout/__tests__/shipping-options.test.tsx`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Cada `li` mostra `{sellerName} — {service}` à esquerda e o preço à direita.
- [ ] **Step 4:** Rodar `pnpm vitest run` e `pnpm tsc --noEmit` em `apps/storefront`. Esperado: tudo verde.
- [ ] **Step 5: Commit** `feat(checkout): mostrar o serviço dos correios de cada loja nos detalhes do frete`
