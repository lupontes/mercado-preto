# Moderação de produtos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produtos novos só vão à vitrine depois que um gestor aprova; edições de produtos já aprovados ficam pendentes (a versão aprovada continua à venda) até aprovação; vendedora e gestores são avisados.

**Architecture:** "Em análise" é o status nativo `proposed` do Medusa. Edições de produto já aprovado ficam em `product.metadata.pending_changes` (o diff do formulário) e só são aplicadas por uma rota de admin que reutiliza a mesma função de atualização da rota da vendedora. Um subscriber de `product.updated` grava `metadata.approved_at` na primeira publicação e avisa a vendedora quando o produto veio da análise.

**Tech Stack:** Medusa v2 (TypeScript, jest unit tests, admin SDK + vitest), Next.js storefront/portal (vitest), Evolution (WhatsApp) e Brevo (e-mail).

**Spec:** `docs/superpowers/specs/2026-10-22-moderacao-de-produtos-design.md`

Caminhos abaixo: `B/` = `packages/medusa-backend/apps/backend/src/`, `S/` = `apps/storefront/src/`.

## Global Constraints

- Status Medusa: `draft` (Rascunho), `proposed` (Em análise), `published` (Publicado). Nenhum estado "Rejeitado".
- Chaves de metadata: `approved_at` (ISO, gravada na 1ª publicação), `submitted_at` (ISO, gravada ao enviar para análise; removida na aprovação), `pending_changes` (objeto `SellerProductChanges` + `submittedAt`).
- Metadata é substituída inteira pelo Medusa: sempre mesclar com a atual antes de gravar.
- Produto "aprovado" = `status === "published"` **ou** `metadata.approved_at` presente. Isso cobre os produtos já publicados e os importados da Nuvemshop sem migração (desvio consciente do spec, que previa migração: mesmo efeito, menos uma peça).
- Textos em pt-BR; código, nomes e comentários em inglês.
- Avisos: falha de envio nunca derruba a requisição (logar e seguir), como nos avisos de etiqueta.
- Variável nova: `MODERATION_ALERT_WHATSAPP` (opcional, telefone do gestor). E-mail dos gestores: `ADMIN_ALERT_EMAIL` (já existe).
- Testes: backend `cd packages/medusa-backend/apps/backend && npm run test:unit -- <path>`; admin `npm run test:admin -- <path>`; portal `cd apps/storefront && npx vitest run <path>`.

## Review Focus

1. Vendedora salva o formulário de um produto publicado **sem mudar nada** (só abre e salva): não pode criar `pending_changes` nem avisar gestores.
2. Vendedora edita, depois desfaz a edição para os valores publicados: a pendência some.
3. Vendedora com produto **nunca aprovado** manda `status: "published"` direto pela API: recusado (400).
4. Gestor publica pelo seletor nativo do Medusa Admin um produto `proposed`: a vendedora é avisada uma única vez (o update do próprio subscriber não avisa de novo).
5. `GET /store/products?fields=+metadata` (chave publicável): recusado, e rotas `/store/*` que não são de produto continuam aceitando `metadata`.

---

### Task 1: Regras puras de moderação

**Files:**
- Create: `B/utils/product-moderation.ts`
- Test: `B/utils/__tests__/product-moderation.unit.spec.ts`

**Interfaces:**
- Produces:
  - `type SellerProductChanges = { title?: string; description?: string; thumbnail?: string; category_id?: string | null; variants?: { id: string; prices: { amount: number; currency_code: string }[] }[]; packageSize?: PackageSize; packageDimensions?: PackageDimensions }` (mesmo formato do corpo do PATCH da vendedora, sem `status`)
  - `type LiveProduct = { status: string; title: string; description: string | null; thumbnail: string | null; metadata: Record<string, unknown> | null; categories?: { id: string }[]; variants?: { id: string; length?: number | null; width?: number | null; height?: number | null; weight?: number | null; prices?: { amount: number; currency_code: string }[] }[] }`
  - `isApproved(p: Pick<LiveProduct, "status" | "metadata">): boolean`
  - `diffSellerChanges(live: LiveProduct, submitted: SellerProductChanges): SellerProductChanges` — só as chaves cujo valor difere do produto vivo
  - `pendingChangesOf(p: Pick<LiveProduct, "metadata">): (SellerProductChanges & { submittedAt: string }) | null`

- [ ] **Step 1: Write the failing tests**

```ts
describe("isApproved", () => {
  it("is true for published", () => expect(isApproved({ status: "published", metadata: null })).toBe(true))
  it("is true for a draft with approved_at", () =>
    expect(isApproved({ status: "draft", metadata: { approved_at: "2026-10-22T10:00:00Z" } })).toBe(true))
  it("is false for draft and proposed without approved_at", () => {
    expect(isApproved({ status: "draft", metadata: {} })).toBe(false)
    expect(isApproved({ status: "proposed", metadata: null })).toBe(false)
  })
})

describe("diffSellerChanges", () => {
  const live: LiveProduct = {
    status: "published", title: "Colar", description: "Búzios", thumbnail: "https://x/a.jpg",
    metadata: { package_size: "small" }, categories: [{ id: "cat_1" }],
    variants: [{ id: "var_1", prices: [{ amount: 5000, currency_code: "brl" }] }],
  }
  it("returns {} when the full form is resubmitted unchanged", () => {
    expect(diffSellerChanges(live, {
      title: "Colar", description: "Búzios", thumbnail: "https://x/a.jpg", category_id: "cat_1",
      variants: [{ id: "var_1", prices: [{ amount: 5000, currency_code: "brl" }] }],
    })).toEqual({})
  })
  it("keeps only changed keys", () => {
    expect(diffSellerChanges(live, { title: "Colar novo", thumbnail: "https://x/a.jpg",
      variants: [{ id: "var_1", prices: [{ amount: 6000, currency_code: "brl" }] }] }))
      .toEqual({ title: "Colar novo", variants: [{ id: "var_1", prices: [{ amount: 6000, currency_code: "brl" }] }] })
  })
  it("treats undefined description and empty string as equal to null", () => {
    expect(diffSellerChanges({ ...live, description: null }, { description: undefined })).toEqual({})
  })
  it("detects a category cleared with null", () => {
    expect(diffSellerChanges(live, { category_id: null })).toEqual({ category_id: null })
  })
  it("detects a package size change and ignores the same preset", () => {
    expect(diffSellerChanges(live, { packageSize: "small" })).toEqual({})
    expect(diffSellerChanges(live, { packageSize: "medium" })).toEqual({ packageSize: "medium" })
  })
  it("compares bulky dimensions against the first variant", () => {
    const bulky = { ...live, metadata: { package_size: "bulky" }, variants: [{ ...live.variants![0], length: 40, width: 30, height: 20, weight: 2 }] }
    const same = { packageSize: "bulky" as const, packageDimensions: { length: 40, width: 30, height: 20, weight: 2 } }
    expect(diffSellerChanges(bulky, same)).toEqual({})
    expect(diffSellerChanges(bulky, { ...same, packageDimensions: { ...same.packageDimensions, weight: 3 } }))
      .toEqual({ packageSize: "bulky", packageDimensions: { length: 40, width: 30, height: 20, weight: 3 } })
  })
})

describe("pendingChangesOf", () => {
  it("returns null without pending_changes", () => expect(pendingChangesOf({ metadata: {} })).toBeNull())
  it("returns the stored object", () => {
    const pending = { title: "Novo", submittedAt: "2026-10-22T10:00:00Z" }
    expect(pendingChangesOf({ metadata: { pending_changes: pending } })).toEqual(pending)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- src/utils/__tests__/product-moderation.unit.spec.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `B/utils/product-moderation.ts`**

Importar `PackageSize`/`PackageDimensions` de `./package-size`. Preço compara o valor `brl` do variant de mesmo `id`. `packageDimensions` só entra no diff junto com `packageSize: "bulky"` (as duas chaves vão juntas quando as medidas mudam).

- [ ] **Step 4: Run to verify it passes** — mesmo comando, PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/product-moderation.ts src/utils/__tests__/product-moderation.unit.spec.ts
git commit -m "feat(moderacao): adicionar regras de produto aprovado e diff da edição"
```

---

### Task 2: Avisos de moderação

**Files:**
- Create: `B/utils/product-moderation-notify.ts`
- Test: `B/utils/__tests__/product-moderation-notify.unit.spec.ts`

**Interfaces:**
- Consumes: `sendWhatsApp(phone, text)` (`B/utils/whatsapp.ts`), `sendBrevoEmail(to, subject, html)` (`B/utils/email.ts`).
- Produces:
  - `type ModerationKind = "new" | "change"`
  - `type ProductRef = { id: string; title: string; handle: string }`
  - `notifyTeamProductSubmitted(product: ProductRef, sellerName: string, kind: ModerationKind): Promise<void>`
  - `notifySellerProductApproved(seller: { name: string; phone: string; email: string }, product: ProductRef, kind: ModerationKind): Promise<void>`
  - `adminProductLink(productId): string | null` = `${origin(BACKEND_URL)}/app/products/${id}`; `storeProductLink(handle): string | null` = `${origin(BACKEND_URL)}/produto/${handle}`

Copy fixa:
- Gestores, assunto: `Produto para analisar — ${product.title}`; corpo: `Novo produto da loja ${sellerName} aguardando análise: ${title}` ou `Alteração de produto da loja ${sellerName} aguardando análise: ${title}`, mais o link do painel. E-mail para `ADMIN_ALERT_EMAIL`; WhatsApp para `MODERATION_ALERT_WHATSAPP` se definido. Sem `ADMIN_ALERT_EMAIL`, só `console.error`, como `alertTeamLabelFailed`.
- Vendedora, novo: `✅ Seu produto *${title}* foi aprovado e já está à venda no Mercado Preto:\n${link}\n\n_Mercado Preto_`; alteração: `✅ A alteração do produto *${title}* foi aprovada e já está na vitrine do Mercado Preto:\n${link}\n\n_Mercado Preto_`. E-mail com o mesmo texto em HTML (`escapeHtml`), assunto `Produto aprovado no Mercado Preto — ${title}`.

- [ ] **Step 1: Write the failing tests** — `jest.mock("../whatsapp")` e `jest.mock("../email")`; com `BACKEND_URL=https://teste.mercadopreto.com.br/api`:
  - `notifyTeamProductSubmitted({id:"prod_1",title:"Colar",handle:"colar"}, "Axé", "new")` → `sendBrevoEmail` com `ADMIN_ALERT_EMAIL`, assunto `"Produto para analisar — Colar"`, HTML contendo `"Novo produto da loja Axé"` e `"https://teste.mercadopreto.com.br/app/products/prod_1"`; `sendWhatsApp` chamado com `MODERATION_ALERT_WHATSAPP` quando definido e não chamado quando ausente.
  - `kind: "change"` → HTML contém `"Alteração de produto da loja Axé"`.
  - `notifySellerProductApproved(seller, product, "new")` → WhatsApp para `seller.phone` com texto contendo `"foi aprovado e já está à venda"` e `"https://teste.mercadopreto.com.br/produto/colar"`; e-mail para `seller.email`.
  - título com `<b>` sai escapado no HTML.
- [ ] **Step 2: Run** `npm run test:unit -- src/utils/__tests__/product-moderation-notify.unit.spec.ts` → FAIL.
- [ ] **Step 3: Implement** seguindo o padrão de `B/utils/shipping-label-notify.ts` (mover `escapeHtml` não é necessário; duplicar a função local é aceitável, ou extrair para `B/utils/html.ts` se preferir — escolha do implementador).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(moderacao): adicionar avisos para gestores e vendedora`

---

### Task 3: Remover a conferência de medidas

**Files:**
- Modify: `B/api/seller/products/package.ts:22-23` (metadata passa a ser sempre `{ package_size: size }`)
- Delete: `B/api/admin/products/[id]/package-review/route.ts` e `.../__tests__/route.unit.spec.ts`
- Delete: `B/admin/widgets/product-package-review.tsx` e `B/admin/widgets/__tests__/product-package-review.test.tsx`
- Modify tests: `B/api/seller/products/__tests__/package-size.unit.spec.ts:41`, `B/api/seller/products/[id]/__tests__/package-size.unit.spec.ts:12,39,45`; o comentário "Re-review only when…" em `B/api/seller/products/[id]/route.ts`.

- [ ] **Step 1:** Ajustar as asserções dos testes de package-size para esperar metadata `{ package_size: "bulky" }` sem `package_review`.
- [ ] **Step 2:** Run `npm run test:unit -- src/api/seller/products` → FAIL nas asserções alteradas.
- [ ] **Step 3:** Alterar `package.ts` e apagar rota, widget e testes deles.
- [ ] **Step 4:** Run `npm run test:unit -- src/api/seller/products` e `npm run test:admin` → PASS; `grep -rn package_review src` → nenhuma ocorrência.
- [ ] **Step 5: Commit** `refactor(produtos): remover a conferência de medidas do painel master`

---

### Task 4: Extrair a aplicação da edição da vendedora

**Files:**
- Create: `B/api/seller/products/apply-update.ts`
- Modify: `B/api/seller/products/[id]/route.ts` (PATCH passa a chamar a função)
- Test: `B/api/seller/products/[id]/__tests__/route.unit.spec.ts` (existentes continuam passando)

**Interfaces:**
- Consumes: `SellerProductChanges` (Task 1).
- Produces: `applySellerProductUpdate(scope: MedusaContainer, productId: string, changes: SellerProductChanges & { status?: "draft" | "proposed" | "published" }, extraMetadata?: Record<string, unknown>): Promise<{ ok: true; product: any } | { ok: false; status: 400; error: string }>` — contém hoje o corpo do PATCH a partir da validação de categoria: categoria (com a checagem de string vazia e existência), pacote (`resolveSellerPackage` + `updateProductVariants`), mescla de metadata com `extraMetadata` e chaves `null` em `extraMetadata` **removem** a chave, e `updateProductsWorkflow`. A checagem "categoria presente no corpo" passa a ser `"category_id" in changes`.

- [ ] **Step 1:** Adicionar teste: `applySellerProductUpdate(scope, "prod_1", { title: "X" }, { pending_changes: null, approved_at: "t" })` chama `updateProductsWorkflow` com `metadata` = metadata atual mesclada, sem `pending_changes` e com `approved_at: "t"`.
- [ ] **Step 2:** Run `npm run test:unit -- "src/api/seller/products/\[id\]"` → FAIL.
- [ ] **Step 3:** Extrair; PATCH vira validação + chamada (sem mudança de comportamento ainda).
- [ ] **Step 4:** Run → PASS (todos os testes antigos da rota inclusive).
- [ ] **Step 5: Commit** `refactor(produtos): extrair a aplicação da edição da vendedora`

---

### Task 5: Cadastro envia para análise

**Files:**
- Modify: `B/api/seller/products/route.ts` (schema e POST; GET inclui `products.metadata`)
- Test: `B/api/seller/products/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `notifyTeamProductSubmitted` (Task 2).

Regras: `status: z.enum(["draft", "proposed"]).default("draft")`. Com `proposed`, metadata recebe `submitted_at` (ISO now) e, depois do vínculo com a loja, os gestores são avisados (`kind: "new"`, nome da loja via `query.graph` do seller). Aviso falho é logado e a resposta continua 201.

- [ ] **Step 1: Tests:**
  - POST com `status: "published"` → 400.
  - POST com `status: "proposed"` → `createProductsWorkflow` recebe `status: "proposed"` e `metadata` com `package_size` e `submitted_at`; `notifyTeamProductSubmitted` chamado com `kind "new"`.
  - POST sem status → `draft`, sem aviso.
  - aviso rejeitando → resposta 201.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(moderacao): enviar produto novo para análise e avisar gestores`

---

### Task 6: Edição pela vendedora respeita a moderação

**Files:**
- Modify: `B/api/seller/products/[id]/route.ts` (GET e PATCH)
- Test: `B/api/seller/products/[id]/__tests__/moderation.unit.spec.ts`

**Interfaces:**
- Consumes: `isApproved`, `diffSellerChanges`, `pendingChangesOf` (Task 1); `applySellerProductUpdate` (Task 4); `notifyTeamProductSubmitted` (Task 2).
- Produces: GET responde `{ product, pendingChanges: SellerProductChanges & { submittedAt } | null }`.

Regras do PATCH (`status: z.enum(["draft","proposed","published"]).optional()`), lendo o produto vivo com os campos de `LiveProduct`:

| Produto | Corpo | Efeito |
|---|---|---|
| nunca aprovado | `status: "published"` | 400 `"Produto ainda não aprovado. Envie para análise."` |
| nunca aprovado | qualquer, `status` draft/proposed | aplica tudo direto; se passou a `proposed` vindo de `draft`, grava `submitted_at` e avisa gestores (`"new"`) |
| aprovado | `status: "proposed"` | 400 (produto aprovado não volta para análise) |
| aprovado | conteúdo | `diff = diffSellerChanges(live, conteúdo)`; vazio → remove `pending_changes`; não vazio → grava `pending_changes = { ...diff, submittedAt }`; avisa gestores (`"change"`) só se o diff mudou em relação à pendência anterior |
| aprovado | `status` draft/published | aplica o status na hora (sem tocar no conteúdo vivo) |
| aprovado sem `approved_at` | qualquer | grava também `approved_at` = now (cobre os já publicados) |

Para produto aprovado, o conteúdo **nunca** vai para `applySellerProductUpdate`; só `status` e metadata (`{ pending_changes, approved_at }`) vão.

- [ ] **Step 1: Tests** (um `it` por linha da tabela, mais):
  - Review Focus 1: produto publicado, corpo idêntico ao vivo → nenhum `pending_changes`, nenhum aviso.
  - Review Focus 2: pendência existente, corpo igual ao vivo → metadata sem `pending_changes`.
  - Review Focus 3: nunca aprovado + `published` → 400.
  - Mudança de preço em produto publicado → `updateProductsWorkflow` **não** recebe `variants`; metadata recebe `pending_changes.variants`.
  - GET devolve `pendingChanges` quando há pendência.
- [ ] **Step 2:** Run `npm run test:unit -- "src/api/seller/products/\[id\]"` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(moderacao): guardar edição de produto aprovado como alteração pendente`

---

### Task 7: Primeira publicação grava a aprovação e avisa a vendedora

**Files:**
- Create: `B/subscribers/product-approved.ts`
- Test: `B/subscribers/__tests__/product-approved.unit.spec.ts`

**Interfaces:**
- Consumes: `notifySellerProductApproved` (Task 2).

Em `product.updated`: lê `status`, `metadata`, `title`, `handle`, `seller.name/phone/email`. Se `status === "published"` e não há `approved_at`: grava metadata mesclada com `approved_at` = now e sem `submitted_at` (via `Modules.PRODUCT.updateProducts`); se havia `submitted_at`, avisa a vendedora (`"new"`). Qualquer outro caso: nada.

- [ ] **Step 1: Tests:**
  - proposed→published com `submitted_at` → update com `approved_at` e sem `submitted_at`; aviso chamado uma vez.
  - published sem `submitted_at` (admin/importador) → grava `approved_at`, sem aviso.
  - Review Focus 4: published com `approved_at` (o evento disparado pelo próprio update) → nenhum update, nenhum aviso.
  - draft/proposed → nada.
- [ ] **Step 2–4:** Run `npm run test:unit -- src/subscribers/__tests__/product-approved.unit.spec.ts` FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `feat(moderacao): registrar aprovação e avisar a vendedora na publicação`

---

### Task 8: API de moderação do painel master

**Files:**
- Create: `B/api/admin/moderation/products/route.ts` (GET lista)
- Create: `B/api/admin/products/[id]/moderation/route.ts` (GET detalhe, POST aprovar)
- Test: `B/api/admin/moderation/products/__tests__/route.unit.spec.ts`, `B/api/admin/products/[id]/moderation/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `pendingChangesOf` (Task 1), `applySellerProductUpdate` (Task 4), `notifySellerProductApproved` (Task 2).
- Produces:
  - `GET /admin/moderation/products` → `{ items: { id, title, thumbnail, sellerName, kind: "new" | "change", submittedAt }[] }`: produtos `proposed` (`submittedAt` = `metadata.submitted_at ?? created_at`) e produtos com `pending_changes` (`submittedAt` = `pending_changes.submittedAt`), ordenados do mais antigo. Paginar em memória como `listTrackableOrders` em `B/jobs/shipping-label-tracking.ts`.
  - `GET /admin/products/:id/moderation` → `{ kind: "new" | "change" | null, pendingChanges, seller: { name, phone } }`.
  - `POST /admin/products/:id/moderation` (sem corpo):
    - `proposed` → `updateProductsWorkflow` com `status: "published"` (o aviso sai da Task 7) → 200.
    - com `pending_changes` → `applySellerProductUpdate(scope, id, pending sem submittedAt, { pending_changes: null })`, depois `notifySellerProductApproved(..., "change")` → 200; erro 400 da aplicação (ex.: categoria apagada) → 409 com a mensagem, pendência mantida.
    - nenhum dos dois → 409 `"Nada para aprovar"`.

- [ ] **Step 1: Tests** para cada caso acima, incluindo a ordenação da lista (mais antigo primeiro).
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npm run test:unit -- src/api/admin`).
- [ ] **Step 5: Commit** `feat(moderacao): adicionar API de análise de produtos no painel master`

---

### Task 9: Telas do painel master

**Files:**
- Create: `B/admin/hooks/moderation.ts` (react-query, padrão de `B/admin/hooks/sellers.ts`)
- Create: `B/admin/routes/moderation/page.tsx` (label `"Produtos em análise"`)
- Create: `B/admin/widgets/product-moderation.tsx` (zone `product.details.side.before`)
- Test: `B/admin/routes/moderation/__tests__/page.test.tsx`, `B/admin/widgets/__tests__/product-moderation.test.tsx`

**Interfaces:**
- Consumes: endpoints da Task 8.

Página: tabela com foto, título, loja, tipo (`Novo` / `Alteração`), data de envio (pt-BR); linha leva a `/products/:id`. Vazia: `"Nenhum produto aguardando análise."`.
Widget (só aparece se `kind` não for null):
- título `"Análise"`, badge laranja `"Em análise"` ou `"Alteração em análise"`;
- `kind "change"`: lista "Campo: antes → depois" para cada chave de `pendingChanges` (rótulos: Título, Descrição, Preço em R$, Foto como miniatura, Categoria, Embalagem);
- botão `"Aprovar e publicar"` (new) ou `"Aprovar alteração"` (change) → POST; toast `"Produto aprovado"`; invalida queries;
- link `"Falar com a vendedora no WhatsApp"` → `https://wa.me/55${digits}` (sem duplicar o 55 se já vier);
- texto de ajuda: `"Para trocar a foto, use Mídia e marque a nova como miniatura."`

- [ ] **Step 1: Tests:** widget oculto com `kind: null`; mostra "Aprovar e publicar" para new e chama POST; mostra o diff de preço "R$ 50,00 → R$ 60,00" para change; link wa.me correto. Página lista itens e o texto vazio.
- [ ] **Step 2–4:** `npm run test:admin -- src/admin` FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `feat(moderacao): adicionar a fila de análise e o quadro do produto no painel master`

---

### Task 10: Bloquear metadata de produto na API pública

**Files:**
- Modify: `B/utils/store-fields-guard.ts` (nova `findForbiddenProductField(fields): string | null`)
- Modify: `B/api/middlewares.ts:39-45` (aplica a nova checagem só quando `req.path` começa com `/store/products`)
- Test: `B/utils/__tests__/store-fields-guard.unit.spec.ts` e o teste do middleware, se existir

Regra: token cujo primeiro segmento (sem prefixo `+-*`) é `metadata` é proibido; `*` sozinho também.

- [ ] **Step 1: Tests:** `"+metadata"`, `"metadata"`, `"*metadata"` → proibidos; `"title,+variants.prices"` → null; Review Focus 5: middleware com path `/store/carts/x` e `fields=+metadata` → `next()`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `fix(seguranca): bloquear metadata de produto na api da loja`

---

### Task 11: Portal da vendedora

**Files:**
- Modify: `S/app/painel/produtos/novo/page.tsx:19,137-140` (opções `Rascunho` / `Enviar para análise` → `draft`/`proposed`)
- Modify: `S/app/painel/produtos/[id]/page.tsx` (tipo de status, seletor, preenchimento, aviso)
- Modify: `S/app/painel/produtos/page.tsx:151-158` (rótulos)
- Modify: `S/lib/seller-api.ts` (tipo de retorno de `getSellerProduct` com `pendingChanges`)
- Test: `S/app/painel/produtos/{novo,[id]}/__tests__/page.test.tsx`, `S/app/painel/produtos/__tests__/page.test.tsx` se existir

Edição:
- seletor: produto aprovado (`status === "published"` ou `metadata.approved_at`) → `Rascunho` / `Publicar`; senão → `Rascunho` / `Enviar para análise`; status `proposed` é exibido como `Enviar para análise` selecionado;
- formulário preenche com `pendingChanges` por cima do produto vivo (preço de `pendingChanges.variants[0]`, embalagem de `packageSize`/`packageDimensions`);
- faixa no topo quando há pendência: `"Alteração em análise. A versão anterior continua à venda até a aprovação."`;
- após salvar produto aprovado com mudança: mensagem `"Alteração enviada para análise."` antes de voltar à lista.
Lista: `proposed` → `"Em análise"`; publicado com `metadata.pending_changes` → `"Publicado · alteração em análise"`; remover `rejected`.

- [ ] **Step 1: Tests:** novo produto envia `status: "proposed"` ao escolher "Enviar para análise"; edição de produto aprovado mostra opção "Publicar" e não "Enviar para análise"; com `pendingChanges.title` o campo título vem preenchido com a versão pendente e a faixa aparece; lista mostra os rótulos novos.
- [ ] **Step 2–4:** `cd apps/storefront && npx vitest run src/app/painel/produtos` FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `feat(moderacao): mostrar análise e alteração pendente no portal da vendedora`

---

### Task 12: Configuração e documentação

**Files:**
- Modify: `infra/.env.template` (`MODERATION_ALERT_WHATSAPP=` com comentário)
- Modify: `HANDOFF.md`

- [ ] **Step 1:** Adicionar a variável comentada: telefone do gestor que recebe o aviso de produto para analisar; vazio = só e-mail.
- [ ] **Step 2:** Rodar a suíte completa: `npm run test:unit`, `npm run test:admin`, `cd apps/storefront && npx vitest run`, e `npx tsc --noEmit` no backend e no storefront → tudo verde.
- [ ] **Step 3:** HANDOFF: moderação implementada na branch, deploy pendente, roteiro de teste para o Ailton pendente.
- [ ] **Step 4: Commit** `docs(moderacao): registrar variável do aviso aos gestores e atualizar handoff`
