# Busca e Páginas Públicas da Loja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A busca não cai e não aceita injeção, os índices acompanham produtos e lojas, as páginas públicas só mostram lojas ativas e produtos publicados, e os totais de comissão consideram todas as vendas.

**Architecture:**
- **`utils/meilisearch.ts`:**
  - ganha `meiliFilterValue`;
  - aplica as configurações dos índices uma vez por processo, no primeiro `getMeiliClient()`.
- **Rota de busca:** escapa os valores do filtro e cai no banco em caso de erro.
- **Subscribers:** um por evento de remoção.
- **Status das lojas:** as rotas que mudam o status emitem `seller.status_changed`.

**Tech Stack:** Medusa v2, Jest.

**Spec:** `docs/superpowers/specs/2026-10-17-busca-e-loja-publica-design.md`

## Global Constraints

- O evento de status é `seller.status_changed`, com payload `{ id }`.
- `meiliFilterValue(v)` devolve `"` + `v` com `\` → `\\` e `"` → `\"` + `"`.
- A mensagem de 404 da loja é `Vendedor não encontrado`, a mesma de hoje.
- Backend: `npm run test:unit -- <path>` e `npx tsc --noEmit -p .` antes de cada commit. **Não usar `pnpm`**, porque ele reinstala o backend.
- Código e comentários em inglês. Commits em Conventional Commits, em pt-BR, com o trailer da sessão.

## Review Focus

- **Meilisearch fora do ar ou índice sem configuração:** a busca responde 200 pelo banco (Task 2).
- **Loja ativada pelo link de senha:** entra no índice (Tasks 3 e 4).
- **Produto que passa de publicado a rascunho:** continua no índice com `status: "draft"`, e o filtro da busca o exclui. Sem mudança, mas há teste (Task 3).
- **Busca pelo banco com `offset` maior que o total:** devolve lista vazia com o `total` certo (Task 2).
- **Loja `approved` sem senha:** a página pública responde 404 até ela ativar (Task 5).

---

### Task 1: `meiliFilterValue` e configurações aplicadas no primeiro uso

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/utils/meilisearch.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/meilisearch.unit.spec.ts`

**Interfaces:**
- Produces:
  - `meiliFilterValue(value: string): string`;
  - `getMeiliClient()`, que na primeira chamada com host configurado espera `ensureIndexes()` uma vez por processo. Expor `resetMeiliSetupForTests()` para os testes.

- [ ] **Step 1: Testes que falham:**
  - `meiliFilterValue`:
    - `'a'` → `'"a"'`;
    - `'x" OR status = "draft'` → `'"x\\" OR status = \\"draft"'`;
    - `'a\\b'` → `'"a\\\\b"'`.
  - Duas chamadas de `getMeiliClient()` chamam o `updateSettings` do mock exatamente 2 vezes no total: uma para cada índice, uma vez só. O mock do `meilisearch` ganha `index()` devolvendo `{ updateSettings: jest.fn().mockResolvedValue({}), ... }`.
- [ ] **Step 2:** Rodar o arquivo. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Guardar uma promise de setup no módulo. Os erros do `ensureIndexes` já são engolidos lá.
- [ ] **Step 4:** Rodar o arquivo, `npm run test:unit` e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(busca): aplicar a configuração dos índices no primeiro uso e escapar filtros`

### Task 2: Rota de busca segura e busca pelo banco correta

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/search/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/search/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `meiliFilterValue` e `getMeiliClient` (Task 1). Nos testes, `jest.mock("../../../../utils/meilisearch")`.

- [ ] **Step 1: Testes que falham:**
  - **Meilisearch disponível:** com `category = 'x" OR status = "draft'`, o `filter` passado a `search` é exatamente `status = "published" AND category = "x\" OR status = \"draft"`.
  - **Meilisearch que lança erro:**
    - responde 200 com `hits` vindos do banco;
    - `logger.error` é chamado uma vez, com no máximo 2 argumentos.
  - **Busca pelo banco, produtos:**
    - 30 produtos publicados, com o `q` casando só com o 25º → `hits` tem esse produto e `total: 1`;
    - `seller_id` filtra por `seller.id`;
    - `offset` além do total devolve `hits: []` com o `total` certo.
  - **Busca pelo banco, lojas:** `category` e `location` filtram, e os hits passam por `toPublicSeller`, sem `email`.
- [ ] **Step 2:** Rodar `npm run test:unit -- src/api/store/search`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - Produtos pelo banco: `query.graph` com `fields` + `seller.id`, `filters: { status: "published" }` e sem paginação; filtrar em memória; depois `slice`.
  - Lojas: `listSellers({ status: "active" })` sem paginação; filtrar; depois `slice`.
  - Comentário curto dizendo que isso só serve enquanto o catálogo for pequeno.
- [ ] **Step 4:** Rodar, `npm run test:unit` e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(busca): escapar filtros, cair no banco quando o meilisearch falha e paginar depois de filtrar`

### Task 3: Subscribers dos índices

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/product-search-index.ts`
- Create: `packages/medusa-backend/apps/backend/src/subscribers/product-search-remove.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/seller-search-index.ts`
- Test: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/search-index.unit.spec.ts`

**Interfaces:**
- Produces: `seller-search-index.ts` escuta `["seller.approved", "seller.status_changed"]`.

- [ ] **Step 1: Testes que falham** (`jest.mock("../../utils/meilisearch")`):
  - o default de `product-search-index` com um produto publicado chama `indexProduct` com `status: "published"`; com um produto em rascunho, chama `indexProduct` com `status: "draft"`; o config escuta exatamente `["product.created", "product.updated"]`;
  - o default de `product-search-remove` chama `removeProduct(id)`; o config escuta `"product.deleted"`;
  - o default de `seller-search-index`:
    - loja `active` → `indexSeller`, sem e-mail nem hash no documento;
    - `approved`, `pending` ou `suspended` → `removeSeller(id)`;
    - loja inexistente → `removeSeller(id)`;
    - o config escuta `["seller.approved", "seller.status_changed"]`.
- [ ] **Step 2:** Rodar `npm run test:unit -- src/subscribers/__tests__/search-index.unit.spec.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Remover as funções nomeadas que nunca rodavam (`productDeleted`, `sellerUpdatedIndex`).
- [ ] **Step 4:** Rodar, `npm run test:unit` e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(busca): remover produtos apagados e atualizar lojas no índice`

### Task 4: Emitir `seller.status_changed`

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/activate/route.ts`, `[id]/suspend/route.ts`, `[id]/reject/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/store/sellers/set-password/route.ts`
- Test: os testes existentes de cada rota, mais `api/admin/sellers/__tests__/no-password-hash.unit.spec.ts`, que já resolve `event_bus`

**Interfaces:**
- Consumes: o evento da Task 3.

- [ ] **Step 1: Testes que falham:**
  - `activate`, `suspend` e `reject` emitem `{ name: "seller.status_changed", data: { id: "seller_1" } }` pelo `event_bus` depois de atualizar;
  - `set-password` com token válido emite o mesmo evento. O mock do `req.scope` passa a resolver `event_bus`;
  - no `set-password`, uma falha do `emit` **não** muda a resposta: continua 200, e o erro vai para o log. A senha já foi gravada.
- [ ] **Step 2:** Rodar os arquivos. Esperado: FAIL.
- [ ] **Step 3: Implementar** com `req.scope.resolve(Modules.EVENT_BUS)`.
- [ ] **Step 4:** Rodar, `npm run test:unit` e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(vendedor): avisar a mudança de status da loja para atualizar a busca`

### Task 5: Páginas públicas da loja e comissões

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/sellers/[id]/route.ts`, `[id]/products/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/seller/commissions/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/sellers/[id]/__tests__/route.unit.spec.ts`, `[id]/products/__tests__/route.unit.spec.ts` e `api/seller/commissions/__tests__/route.unit.spec.ts`

- [ ] **Step 1: Testes que falham:**
  - `GET /store/sellers/:id`: `it.each(["pending", "approved", "suspended"])` → 404 `Vendedor não encontrado`; `active` → 200, sem `email`, `cpfCnpj` nem `passwordHash`;
  - `GET /store/sellers/:id/products`:
    - loja não ativa → 404;
    - com 3 produtos, 1 em rascunho, devolve 2 e `count: 2`;
    - a paginação vale sobre os publicados;
  - `GET /seller/commissions`:
    - com `listAndCountCommissions` devolvendo 20 itens e `count` 25, e `listCommissions` (sem paginação) devolvendo os 25, a resposta tem `count: 25`;
    - os `totals` somam os 25;
    - o filtro usa sempre o `sellerId` da sessão, e o `status` da query é respeitado.
- [ ] **Step 2:** Rodar os arquivos. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** Rodar `npm run test:unit` inteiro e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(loja): mostrar só lojas ativas e produtos publicados e somar todas as comissões`
