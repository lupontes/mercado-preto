# Cobertura de Testes, Fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os bugs da fase 2 (relatórios, contagem fiscal, sitemap e analytics) e cobrir com testes as rotas, os subscribers e as páginas que ainda não têm nenhum.

**Architecture:**
- **Correções:** pontuais em cada rota.
- **Sitemap:** a vitrine ganha `app/sitemap.xml/route.ts`, que repassa o sitemap do backend, e `app/robots.ts`.
- **Testes:** o resto é teste, no estilo de cada pasta.

**Tech Stack:** Medusa v2 (Jest), Next.js (Vitest).

**Spec:** `docs/superpowers/specs/2026-10-17-cobertura-fase-2-design.md`

## Global Constraints

- Mensagem de período inválido: `Período inválido`, com status 400.
- Rotas estáticas do sitemap, nesta ordem: `/`, `/lojas`, `/produtos`, `/categorias` e `/sobre`.
- O robots bloqueia `/painel`, `/checkout` e `/carrinho`.
- Backend: `npm run test:unit -- <path>` e `npx tsc --noEmit -p .`.
- Vitrine: **`npx vitest run`** e **`npx tsc --noEmit`**. Nunca `pnpm`, porque ele reinstala o backend.
- Commits em Conventional Commits, em pt-BR, com o trailer da sessão.

## Review Focus

- **`period_end` com data e hora ISO:** é respeitado como veio, sem esticar até o fim do dia (Task 1).
- **Sitemap com um handle com `&`:** sai escapado no XML. O escape já existe, mas falta teste (Task 3).
- **Backend fora do ar ao pedir `/sitemap.xml`:** 503, sem quebrar a página (Task 3).
- **Analytics atrás do nginx:** usa o último IP do `X-Forwarded-For`, que é o que o nginx acrescenta (Task 4).
- **Telefone sem DDI no WhatsApp:** o comportamento de hoje é mantido e fica registrado pelo teste (Task 5).

---

### Task 1: Período do relatório do admin

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/reports/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/reports/__tests__/route.unit.spec.ts`

- [ ] **Step 1: Testes que falham:**
  - com `period_end=2026-10-31`, uma comissão criada em `2026-10-31T15:00:00Z` entra;
  - com `period_end=2026-10-31T12:00:00.000Z`, uma comissão de `2026-10-31T15:00:00Z` fica de fora;
  - `period_start=abc` → 400 `Período inválido`;
  - `period_start` depois de `period_end` → 400;
  - os totais (`totalGmv`, `totalCommission`, `totalPayouts`, `pendingPayouts`) e `sellers` somam só o período.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar** `parsePeriodBoundary(value, endOfDay)`. Uma data `YYYY-MM-DD` vira `T00:00:00.000Z` no início ou `T23:59:59.999Z` no fim.
- [ ] **Step 4:** Rodar, a suíte e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(admin): incluir o último dia do período no relatório e validar as datas`

### Task 2: Fiscal, configurações e reindex

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/fiscal/route.ts`
- Test, em `packages/medusa-backend/apps/backend/src/api/admin/`:
  - `fiscal/__tests__/route.unit.spec.ts`;
  - `fiscal/[id]/__tests__/route.unit.spec.ts`;
  - `settings/__tests__/route.unit.spec.ts`;
  - `search/reindex/__tests__/route.unit.spec.ts`.

- [ ] **Step 1: Testes:**
  - `fiscal`: `listAndCountNfDocuments` devolve 20 itens e count 45, e a resposta tem `count: 45` (falha hoje); os filtros `seller_id`, `status`, `order_id` e `ncm_fallback_used=true` viram os campos certos;
  - `fiscal/[id]`: 404 `Documento não encontrado`, ou 200 com o `document`;
  - `settings`:
    - o GET devolve `{ settings: { commissionRate } }`;
    - o PATCH com 12 grava 12;
    - 101 e -1 dão 400 sem gravar;
  - `reindex`: ler a rota e registrar o comportamento de hoje, com e sem Meilisearch.
- [ ] **Step 2:** Rodar. Esperado: só o `count` do fiscal falha.
- [ ] **Step 3: Implementar** `listAndCountNfDocuments` no fiscal.
- [ ] **Step 4:** Rodar, a suíte e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(admin): contar todos os documentos fiscais e cobrir fiscal, configurações e reindex`

### Task 3: Sitemap

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/sitemap/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/sitemap/__tests__/route.unit.spec.ts`
- Create: `apps/storefront/src/app/sitemap.xml/route.ts` e `apps/storefront/src/app/robots.ts`
- Test: `apps/storefront/src/app/__tests__/sitemap-robots.test.ts`

- [ ] **Step 1: Testes que falham:**
  - backend:
    - URLs `${site}/produto/<handle>` e `${site}/loja/<id>`;
    - as rotas estáticas exatas, sem `/contato`;
    - produto de loja não ativa fica de fora (`query.graph` com `seller.status`);
    - um handle `a&b` sai como `a&amp;b`;
  - vitrine:
    - `GET` de `sitemap.xml` chama `${NEXT_PUBLIC_MEDUSA_URL}/store/sitemap` com o cabeçalho `x-publishable-api-key` e devolve o corpo com `Content-Type: application/xml`;
    - um backend que responde 500, ou um `fetch` que lança, dá 503;
    - `robots()` tem `disallow` com as três rotas e `sitemap: ${NEXT_PUBLIC_SITE_URL}/sitemap.xml`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** Rodar as duas suítes e os dois tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(seo): corrigir as urls do sitemap e publicar sitemap.xml e robots.txt na vitrine`

### Task 4: Analytics

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/analytics/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/analytics/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: o IP que `rateLimitKeyGenerator` usa. Extrair de `api/middlewares.ts` uma `clientIp(req): string | undefined`, que o `rateLimitKeyGenerator` passa a usar.

- [ ] **Step 1: Testes:**
  - sem `PLAUSIBLE_URL` → 204;
  - corpo sem `name` → 400, sem `fetch`;
  - `name` com 501 caracteres → 400;
  - socket `10.0.0.5` (o nginx) com `X-Forwarded-For: 1.1.1.1, 200.1.1.1` → o Plausible recebe `X-Forwarded-For: 200.1.1.1`;
  - socket público `8.8.8.8` com `X-Forwarded-For: 1.1.1.1` → recebe `8.8.8.8`;
  - um `fetch` que falha ainda responde 202;
  - os testes existentes do `rateLimitKeyGenerator` continuam verdes.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** Rodar, a suíte e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(analytics): usar o ip confiável e validar o evento`

### Task 5: Dashboard do vendedor e subscribers de WhatsApp

**Files:**
- Test: `packages/medusa-backend/apps/backend/src/api/seller/dashboard/__tests__/route.unit.spec.ts`
- Test: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-shipped-whatsapp.unit.spec.ts` e `order-completed-whatsapp.unit.spec.ts`

- [ ] **Step 1: Testes:**
  - dashboard:
    - `listCommissions` é chamado com o `sellerId` da sessão;
    - `totalRevenue` soma `sellerPayout`, e `pendingPayout` soma só as pendentes;
    - `productCount` vem do `query.graph`;
    - sem loja, `productCount` é 0;
  - WhatsApp, com `jest.mock("../../utils/whatsapp")`:
    - a mensagem do enviado tem `#<display_id>` e o rastreio quando há `tracking_number`, e não tem a linha de rastreio quando não há;
    - a do entregue tem `#<display_id>`;
    - sem telefone, `sendWhatsApp` não é chamado;
    - o nome vem do endereço, ou `Cliente` quando falta;
    - os configs escutam `order.shipment_created` e `order.completed`.
- [ ] **Step 2:** Rodar. Esperado: PASS, porque são testes de caracterização. **Antes de dar a task por concluída, quebrar uma asserção de propósito para provar que cada arquivo pega uma regressão, e desfazer.**
- [ ] **Step 3:** Se um teste revelar um bug pequeno, corrigir com TDD e registrar no ledger.
- [ ] **Step 4: Commit** `test(vendedor): cobrir o dashboard e as mensagens de whatsapp do pedido`

### Task 6: Páginas da vitrine

**Files** (testes, em `apps/storefront/src/app/`):
- `carrinho/__tests__/page.test.tsx`;
- `produto/[handle]/__tests__/page.test.tsx`;
- `painel/comissoes/__tests__/page.test.tsx`;
- `painel/pedidos/__tests__/page.test.tsx`;
- `painel/dashboard/__tests__/page.test.tsx`.

O painel do dashboard já tem `address-banner.test.tsx`; ampliar ou criar ao lado.

- [ ] **Step 1: Ler cada página e escrever os testes do comportamento visível:**
  - carrinho: com 2 itens no `useCartStore`, mostra o subtotal formatado; alterar a quantidade atualiza a soma; remover tira o item; carrinho vazio mostra a mensagem de vazio e o link para produtos;
  - produto: com o fetch do produto mockado (no estilo dos testes de página que já existem), mostra título e preço; "Adicionar ao carrinho" põe o item no store; um produto inexistente chama `notFound()`;
  - comissões: com a API mockada (totais, count e uma linha), mostra os totais formatados e a linha;
  - pedidos: lista os pedidos com o status em pt-BR, usando o helper de status existente;
  - dashboard: mostra os números de `stats`.
- [ ] **Step 2:** Rodar `npx vitest run src/app/<página>`. Esperado: PASS. Quebrar uma asserção de propósito em cada arquivo para provar que ele pega uma regressão, e desfazer.
- [ ] **Step 3:** Um bug pequeno se corrige com TDD; um grande vai para o HANDOFF.
- [ ] **Step 4:** Rodar `npx vitest run` e `npx tsc --noEmit`. Esperado: verde.
- [ ] **Step 5: Commit** `test(vitrine): cobrir carrinho, produto e as páginas do painel`
