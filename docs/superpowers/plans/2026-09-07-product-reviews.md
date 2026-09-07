# Sistema de Avaliação de Produtos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comprador recebe um e-mail depois que o pedido é concluído, com um link único que leva a uma tela de avaliação (nota 1-5 + comentário opcional) de cada produto daquele pedido, sem precisar criar conta. A avaliação fica pendente até o vendedor aprovar no painel dele; só então aparece na página pública do produto.

**Architecture:** Novo módulo Medusa `review` (model + service + migração). Um subscriber novo no evento `order.completed` gera um token assinado (HMAC, mesmo padrão de `seller-jwt.ts`) e envia por e-mail (Brevo) um link `/avaliar/{token}`. O token nunca é persistido — só o `Review` em si, quando o comprador de fato envia. Rotas públicas (`/store/*`) pra buscar o convite e submeter avaliação; rotas protegidas (`/seller/*`, sessão via cookie já existente) pra o vendedor aprovar/rejeitar.

**Tech Stack:** Medusa v2 (backend), Next.js 15 App Router (storefront), Vitest (frontend), Jest/SWC (backend), Zod (validação de rota).

**Spec:** `docs/superpowers/specs/2026-09-07-product-reviews-design.md`

## Global Constraints

- Nenhuma conta de comprador é criada — autenticação da ação de avaliar é só o token assinado na URL.
- `sellerId` de uma avaliação **nunca** vem do corpo da requisição do comprador — sempre resolvido server-side a partir de `order.metadata.seller_id` (mesma disciplina de segurança do split de pedido por vendedor).
- Restrição de unicidade `(order_id, product_id)` impede reavaliar o mesmo item — via índice único na migração raw-SQL, não no `model.define`.
- Resolver produto a partir de um item de pedido usa sempre `item.variant_id` via `query.graph` (nunca um campo `product_id` inexistente no item) — mesmo padrão de `modules/fiscal/ncm-resolver.ts:30-39`.
- Rotas sob `/seller/*` já recebem `sellerAuth` automaticamente via `matcher: "/seller"` em `api/middlewares.ts` — não precisam de guarda de auth própria, só ler `(req as any).sellerId`.
- `select` em `retrieveOrder`/`listOrders` é uma whitelist explícita — campo não listado some mesmo existindo na coluna (`email`, `metadata`, `status`, `created_at`, `display_id`, `total` precisam estar lá quando usados).

---

### Task 1: Módulo `review` — model, service, migração

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/modules/review/index.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/review/models/review.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/review/service.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/review/migrations/Migration20260907120000.ts`
- Modify: `packages/medusa-backend/apps/backend/medusa-config.ts`
- Test: `packages/medusa-backend/apps/backend/src/modules/review/__tests__/service.unit.spec.ts`

**Interfaces:**
- Produces: `REVIEW_MODULE` (string `"review"`), `ReviewModuleService` com métodos `MedusaService` padrão (`createReviews`, `listReviews`, `updateReviews`, `retrieveReview`) sobre o model `Review { id, orderId, productId, sellerId, rating, comment, reviewerName, status }`. Consumido pelas Tasks 5, 6, 7.

- [ ] **Step 1: Criar o model**

`packages/medusa-backend/apps/backend/src/modules/review/models/review.ts`:

```ts
import { model } from "@medusajs/framework/utils"

const Review = model.define("review", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  productId: model.text(),
  sellerId: model.text(),
  rating: model.number(),
  comment: model.text().nullable(),
  reviewerName: model.text(),
  status: model.enum(["pending", "published", "rejected"]).default("pending"),
})

export default Review
```

- [ ] **Step 2: Criar o service**

`packages/medusa-backend/apps/backend/src/modules/review/service.ts`:

```ts
import { MedusaService } from "@medusajs/framework/utils"
import Review from "./models/review"

class ReviewModuleService extends MedusaService({ Review }) {}

export default ReviewModuleService
```

- [ ] **Step 3: Criar o index do módulo**

`packages/medusa-backend/apps/backend/src/modules/review/index.ts`:

```ts
import { Module } from "@medusajs/framework/utils"
import ReviewModuleService from "./service"

export const REVIEW_MODULE = "review"

export default Module(REVIEW_MODULE, {
  service: ReviewModuleService,
})
```

- [ ] **Step 4: Escrever a migração (com índice único)**

`packages/medusa-backend/apps/backend/src/modules/review/migrations/Migration20260907120000.ts`:

```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260907120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "review" ("id" text not null, "orderId" text not null, "productId" text not null, "sellerId" text not null, "rating" int not null, "comment" text null, "reviewerName" text not null, "status" text check ("status" in ('pending', 'published', 'rejected')) not null default 'pending', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "review_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_review_deleted_at" ON "review" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_review_order_product_unique" ON "review" ("orderId", "productId") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "review" cascade;`);
  }

}
```

- [ ] **Step 5: Registrar o módulo em `medusa-config.ts`**

Em `packages/medusa-backend/apps/backend/medusa-config.ts`, dentro do array `modules:` (mesmo bloco onde `seller`, `commission`, `payout`, `fiscal`, `marketplace-channel`, `checkout` já estão registrados), adicionar:

```ts
    // Avaliação de produtos — vinculada a pedido concluído, via link assinado
    {
      resolve: "./src/modules/review",
    },
```

- [ ] **Step 6: Escrever o teste do service**

`packages/medusa-backend/apps/backend/src/modules/review/__tests__/service.unit.spec.ts` — segue exatamente o padrão de `modules/seller/__tests__/service.unit.spec.ts`: mocka `MedusaService` (a classe real tenta inicializar conexão com o banco no construtor) antes de importar o service real, e testa lógica própria do service, não o CRUD genérico que o `MedusaService` já dá de graça (isso é coberto pelas rotas nas Tasks 5-7). Como `ReviewModuleService` desta task não tem nenhum método próprio (só `MedusaService({ Review })`, sem métodos extras como o `approveSeller` do `seller`), o teste aqui apenas confirma que a classe instancia e expõe os métodos gerados:

```ts
jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        createReviews = jest.fn().mockResolvedValue({ id: "review_1", orderId: "order_1", status: "pending" })
      },
  }
})

import ReviewModuleService from "../service"

describe("ReviewModuleService", () => {
  it("exposes createReviews from the generated MedusaService CRUD", async () => {
    const service = new ReviewModuleService() as any

    const review = await service.createReviews({
      orderId: "order_1",
      productId: "prod_1",
      sellerId: "seller_1",
      rating: 5,
      comment: "Produto ótimo!",
      reviewerName: "Maria Silva",
    })

    expect(review.orderId).toBe("order_1")
    expect(review.status).toBe("pending")
  })
})
```

- [ ] **Step 7: Rodar o teste**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/modules/review/__tests__/service.unit.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/review packages/medusa-backend/apps/backend/medusa-config.ts
git commit -m "feat(review): adiciona módulo de avaliação de produtos"
```

---

### Task 2: `utils/review-jwt.ts` — token assinado do link de avaliação

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/review-jwt.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/review-jwt.unit.spec.ts`

**Interfaces:**
- Produces: `createReviewToken(orderId: string): string`, `verifyReviewToken(token: string): ReviewTokenPayload` onde `ReviewTokenPayload = { orderId: string; type: "review"; iat: number; exp: number }`. Consumido pelas Tasks 4 e 5.

- [ ] **Step 1: Escrever os testes que falham**

`packages/medusa-backend/apps/backend/src/utils/__tests__/review-jwt.unit.spec.ts`:

```ts
import { createReviewToken, verifyReviewToken } from "../review-jwt"

describe("review-jwt", () => {
  const original = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret"
  })

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original
  })

  it("round-trips orderId through create + verify", () => {
    const token = createReviewToken("order_1")

    const payload = verifyReviewToken(token)

    expect(payload.orderId).toBe("order_1")
    expect(payload.type).toBe("review")
  })

  it("throws on a token with the wrong number of segments", () => {
    expect(() => verifyReviewToken("not-a-real-token")).toThrow("Invalid token format")
  })

  it("throws when the signature was tampered with", () => {
    const token = createReviewToken("order_1")
    const [header, body] = token.split(".")
    const tampered = `${header}.${body}.deadbeef`

    expect(() => verifyReviewToken(tampered)).toThrow("Invalid token signature")
  })

  it("throws when the token is expired", () => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(
      JSON.stringify({ orderId: "order_1", type: "review", iat: now - 1000, exp: now - 1 })
    ).toString("base64url")
    const crypto = require("crypto")
    const sig = crypto.createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url")
    const expiredToken = `${header}.${body}.${sig}`

    expect(() => verifyReviewToken(expiredToken)).toThrow("Token expired")
  })

  it("throws when the token type isn't review", () => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(
      JSON.stringify({ orderId: "order_1", type: "seller", iat: now, exp: now + 3600 })
    ).toString("base64url")
    const crypto = require("crypto")
    const sig = crypto.createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url")
    const wrongTypeToken = `${header}.${body}.${sig}`

    expect(() => verifyReviewToken(wrongTypeToken)).toThrow("Invalid token type")
  })
})
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/utils/__tests__/review-jwt.unit.spec.ts`
Expected: FAIL — `../review-jwt` não existe ainda.

- [ ] **Step 3: Implementar**

`packages/medusa-backend/apps/backend/src/utils/review-jwt.ts`:

```ts
import crypto from "crypto"

export type ReviewTokenPayload = {
  orderId: string
  type: "review"
  iat: number
  exp: number
}

export function createReviewToken(orderId: string): string {
  const secret = process.env.JWT_SECRET || "supersecret"
  const now = Math.floor(Date.now() / 1000)
  const payload: ReviewTokenPayload = {
    orderId,
    type: "review",
    iat: now,
    exp: now + 60 * 60 * 24 * 30, // 30 dias
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${sig}`
}

export function verifyReviewToken(token: string): ReviewTokenPayload {
  const secret = process.env.JWT_SECRET || "supersecret"
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Invalid token format")
  const [header, body, sig] = parts
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  if (sig !== expected) throw new Error("Invalid token signature")
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ReviewTokenPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired")
  if (payload.type !== "review") throw new Error("Invalid token type")
  return payload
}
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/utils/__tests__/review-jwt.unit.spec.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/review-jwt.ts packages/medusa-backend/apps/backend/src/utils/__tests__/review-jwt.unit.spec.ts
git commit -m "feat(review): adiciona token assinado do link de avaliação"
```

---

### Task 3: Extrair `utils/email.ts` de `seller-approved-email.ts`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/email.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/seller-approved-email.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/email.unit.spec.ts`

**Interfaces:**
- Produces: `sendBrevoEmail(to: string, subject: string, htmlContent: string): Promise<void>`. Consumido pela Task 4 e por `seller-approved-email.ts` (já existente, só passa a importar em vez de definir).

Este task é refactor puro — comportamento idêntico ao de hoje, só muda onde a função mora. Não há teste novo de comportamento além de mover a cobertura existente.

- [ ] **Step 1: Verificar a cobertura de teste existente**

Rode `cd packages/medusa-backend/apps/backend && npx jest src/subscribers/__tests__/seller-approved-email.unit.spec.ts` antes de mexer em qualquer coisa — deve passar. Esse teste continua sendo a rede de segurança de que o refactor não muda comportamento.

- [ ] **Step 2: Criar `utils/email.ts` com a função extraída**

`packages/medusa-backend/apps/backend/src/utils/email.ts`:

```ts
import { isSandboxMode } from "./sandbox"

export async function sendBrevoEmail(to: string, subject: string, htmlContent: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return

  let recipient = to
  if (isSandboxMode()) {
    const testRecipient = process.env.TEST_EMAIL_RECIPIENT
    if (!testRecipient) {
      console.error(
        "[sandbox] TEST_EMAIL_RECIPIENT não configurado — e-mail não enviado (destinatário real bloqueado em modo sandbox)"
      )
      return
    }
    recipient = testRecipient
  }

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Mercado Preto", email: process.env.EMAIL_FROM || "noreply@mercadopreto.com.br" },
      to: [{ email: recipient }],
      subject,
      htmlContent,
    }),
  })
}
```

- [ ] **Step 3: Atualizar `seller-approved-email.ts` para importar em vez de definir**

Em `packages/medusa-backend/apps/backend/src/subscribers/seller-approved-email.ts`, remover a função `sendBrevoEmail` inline (linhas 5-30, do `async function sendBrevoEmail` até o fechamento) e o `import { isSandboxMode } from "../utils/sandbox"` que só servia a ela, substituindo por:

```ts
import { sendBrevoEmail } from "../utils/email"
```

O restante do arquivo (a função `sellerApprovedEmail` e o `config`) não muda.

- [ ] **Step 4: Confirmar que o teste existente ainda passa**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/subscribers/__tests__/seller-approved-email.unit.spec.ts`
Expected: PASS, sem nenhuma mudança no teste em si — se esse arquivo de teste importa/mocka `sendBrevoEmail` do próprio subscriber (em vez de mockar o `fetch` global), ajuste o import do mock pra `../utils/email` antes de rodar.

- [ ] **Step 5: Escrever um teste dedicado pro util extraído**

`packages/medusa-backend/apps/backend/src/utils/__tests__/email.unit.spec.ts` — `isSandboxMode()` (`utils/sandbox.ts`) retorna `true` a menos que `MARKETPLACE_SANDBOX` seja explicitamente `"false"`, então o teste do caminho feliz precisa desligar o sandbox (ou preencher `TEST_EMAIL_RECIPIENT`) pra não cair no branch de bloqueio:

```ts
import { sendBrevoEmail } from "../email"

describe("sendBrevoEmail", () => {
  const originalApiKey = process.env.BREVO_API_KEY
  const originalSandbox = process.env.MARKETPLACE_SANDBOX

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.BREVO_API_KEY
    else process.env.BREVO_API_KEY = originalApiKey
    if (originalSandbox === undefined) delete process.env.MARKETPLACE_SANDBOX
    else process.env.MARKETPLACE_SANDBOX = originalSandbox
    jest.restoreAllMocks()
  })

  it("does nothing when BREVO_API_KEY is not set", async () => {
    delete process.env.BREVO_API_KEY
    const fetchSpy = jest.spyOn(global, "fetch")

    await sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("posts to the Brevo API when the key is set and sandbox is off", async () => {
    process.env.BREVO_API_KEY = "test-key"
    process.env.MARKETPLACE_SANDBOX = "false"
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response)

    await sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("does nothing in sandbox mode without a TEST_EMAIL_RECIPIENT", async () => {
    process.env.BREVO_API_KEY = "test-key"
    delete process.env.MARKETPLACE_SANDBOX // default is sandbox on
    delete process.env.TEST_EMAIL_RECIPIENT
    const fetchSpy = jest.spyOn(global, "fetch")

    await sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Rodar os testes**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/utils/__tests__/email.unit.spec.ts src/subscribers/__tests__/seller-approved-email.unit.spec.ts`
Expected: PASS (todos)

- [ ] **Step 7: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/email.ts packages/medusa-backend/apps/backend/src/utils/__tests__/email.unit.spec.ts packages/medusa-backend/apps/backend/src/subscribers/seller-approved-email.ts
git commit -m "refactor(email): extrai sendBrevoEmail pra utils/email.ts compartilhado"
```

---

### Task 4: `subscribers/order-review-invite-email.ts`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/subscribers/order-review-invite-email.ts`
- Test: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-review-invite-email.unit.spec.ts`

**Interfaces:**
- Consumes: `createReviewToken` (Task 2), `sendBrevoEmail` (Task 3).

- [ ] **Step 1: Escrever os testes que falham**

`packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-review-invite-email.unit.spec.ts`:

```ts
import orderReviewInviteEmail, { config } from "../order-review-invite-email"
import * as emailUtil from "../../utils/email"
import * as reviewJwt from "../../utils/review-jwt"

describe("orderReviewInviteEmail", () => {
  afterEach(() => jest.restoreAllMocks())

  function buildContainer(order: Record<string, unknown> | null) {
    return {
      resolve: () => ({
        retrieveOrder: jest.fn().mockResolvedValue(order),
      }),
    }
  }

  it("sends a review invite email when the order has a buyer email", async () => {
    jest.spyOn(reviewJwt, "createReviewToken").mockReturnValue("signed-token")
    const sendSpy = jest.spyOn(emailUtil, "sendBrevoEmail").mockResolvedValue(undefined)
    const container = buildContainer({ id: "order_1", email: "cliente@teste.com", display_id: 42 })

    await orderReviewInviteEmail({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendSpy).toHaveBeenCalledWith(
      "cliente@teste.com",
      expect.any(String),
      expect.stringContaining("signed-token")
    )
  })

  it("does nothing when the order has no buyer email", async () => {
    const sendSpy = jest.spyOn(emailUtil, "sendBrevoEmail").mockResolvedValue(undefined)
    const container = buildContainer({ id: "order_1", email: null, display_id: 42 })

    await orderReviewInviteEmail({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendSpy).not.toHaveBeenCalled()
  })

  it("does nothing when the order is not found", async () => {
    const sendSpy = jest.spyOn(emailUtil, "sendBrevoEmail").mockResolvedValue(undefined)
    const container = buildContainer(null)

    await orderReviewInviteEmail({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendSpy).not.toHaveBeenCalled()
  })

  it("listens to order.completed", () => {
    expect(config.event).toBe("order.completed")
  })
})
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/subscribers/__tests__/order-review-invite-email.unit.spec.ts`
Expected: FAIL — o arquivo não existe ainda.

- [ ] **Step 3: Implementar**

`packages/medusa-backend/apps/backend/src/subscribers/order-review-invite-email.ts`:

```ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { createReviewToken } from "../utils/review-jwt"
import { sendBrevoEmail } from "../utils/email"

export default async function orderReviewInviteEmail({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(event.data.id, {
    select: ["email", "display_id"],
  })
  if (!order) return

  const email = (order as any).email
  if (!email) return

  const token = createReviewToken(order.id)
  const baseUrl = process.env.STORE_CORS?.split(",")[0] || "http://localhost:3000"
  const reviewUrl = `${baseUrl}/avaliar/${token}`

  await sendBrevoEmail(
    email,
    "O que você achou da sua compra no Mercado Preto?",
    `
    <h2>Seu pedido #${(order as any).display_id} foi entregue!</h2>
    <p>Sua opinião ajuda outros compradores e fortalece o artesanato afrobrasileiro.</p>
    <p><a href="${reviewUrl}" style="background:#D4A017;color:#1A1A1A;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Avaliar meus produtos</a></p>
    <p>Com axé,<br>Equipe Mercado Preto — Mulheres de Axé do Brasil</p>
    `
  )
}

export const config: SubscriberConfig = {
  event: "order.completed",
}
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/subscribers/__tests__/order-review-invite-email.unit.spec.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa do backend**

Run: `cd packages/medusa-backend/apps/backend && npx jest`
Expected: PASS, sem regressão em `order-completed-whatsapp` (que continua existindo e reagindo ao mesmo evento, sem mudança).

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/subscribers/order-review-invite-email.ts packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-review-invite-email.unit.spec.ts
git commit -m "feat(review): envia e-mail com link de avaliação quando o pedido é concluído"
```

---

### Task 5: Rotas públicas de submissão — `GET /store/reviews/invite/[token]` e `POST /store/reviews`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/store/reviews/invite/[token]/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/store/reviews/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/reviews/invite/[token]/__tests__/route.unit.spec.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/reviews/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `verifyReviewToken` (Task 2), `REVIEW_MODULE`/`ReviewModuleService` (Task 1).
- Produces: resposta de `GET /store/reviews/invite/{token}`: `{ items: Array<{ productId: string; title: string; thumbnail?: string; alreadyReviewed: boolean }> }`. Resposta de `POST /store/reviews`: `{ review: { id, status } }`.

- [ ] **Step 1: Escrever o teste do `GET /store/reviews/invite/[token]` que falha**

`packages/medusa-backend/apps/backend/src/api/store/reviews/invite/[token]/__tests__/route.unit.spec.ts`:

```ts
import { GET } from "../route"
import * as reviewJwt from "../../../../../../utils/review-jwt"

function buildReq(token: string, orderData: Record<string, unknown> | null, graphData: unknown[] = [], reviewData: unknown[] = []) {
  return {
    params: { token },
    scope: {
      resolve: (key: string) => {
        if (key === "review") return { listReviews: jest.fn().mockResolvedValue(reviewData) }
        if (key === "query") return { graph: jest.fn().mockResolvedValue({ data: graphData }) }
        return { retrieveOrder: jest.fn().mockResolvedValue(orderData) }
      },
    },
  } as any
}

function buildRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("GET /store/reviews/invite/[token]", () => {
  afterEach(() => jest.restoreAllMocks())

  it("returns 400 for an invalid token", async () => {
    const req = buildReq("token-invalido", null)
    const res = buildRes()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("returns the reviewable products for a valid token", async () => {
    jest.spyOn(reviewJwt, "verifyReviewToken").mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", items: [{ variant_id: "variant_1" }] }
    const graphData = [{ id: "variant_1", product: { id: "prod_1", title: "Cesta de Vime", thumbnail: "https://x/img.jpg" } }]
    const req = buildReq("token-valido", order, graphData, [])
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: "https://x/img.jpg", alreadyReviewed: false }],
    })
  })

  it("marks a product as already reviewed", async () => {
    jest.spyOn(reviewJwt, "verifyReviewToken").mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", items: [{ variant_id: "variant_1" }] }
    const graphData = [{ id: "variant_1", product: { id: "prod_1", title: "Cesta de Vime", thumbnail: null } }]
    const existingReview = [{ productId: "prod_1" }]
    const req = buildReq("token-valido", order, graphData, existingReview)
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: null, alreadyReviewed: true }],
    })
  })
})
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/reviews/invite`
Expected: FAIL — a rota não existe ainda.

- [ ] **Step 3: Implementar `GET /store/reviews/invite/[token]`**

`packages/medusa-backend/apps/backend/src/api/store/reviews/invite/[token]/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { verifyReviewToken } from "../../../../../utils/review-jwt"
import { REVIEW_MODULE } from "../../../../../modules/review"
import ReviewModuleService from "../../../../../modules/review/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { token } = req.params as { token: string }

  let payload
  try {
    payload = verifyReviewToken(token)
  } catch (err) {
    return res.status(400).json({ error: "Link de avaliação inválido ou expirado" })
  }

  const orderService = req.scope.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(payload.orderId, { relations: ["items"] })
  if (!order) {
    return res.status(400).json({ error: "Pedido não encontrado" })
  }

  const variantIds = ((order as any).items ?? [])
    .map((item: any) => item.variant_id)
    .filter(Boolean)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "product.id", "product.title", "product.thumbnail"],
    filters: { id: variantIds },
  })

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const existingReviews = await reviewService.listReviews({ orderId: payload.orderId })
  const reviewedProductIds = new Set(existingReviews.map((r: any) => r.productId))

  const seen = new Set<string>()
  const items = (data as any[])
    .filter((variant) => variant.product && !seen.has(variant.product.id) && seen.add(variant.product.id))
    .map((variant) => ({
      productId: variant.product.id,
      title: variant.product.title,
      thumbnail: variant.product.thumbnail,
      alreadyReviewed: reviewedProductIds.has(variant.product.id),
    }))

  res.json({ items })
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/reviews/invite`
Expected: PASS (3 testes)

- [ ] **Step 5: Escrever o teste do `POST /store/reviews` que falha**

`packages/medusa-backend/apps/backend/src/api/store/reviews/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"
import * as reviewJwt from "../../../../utils/review-jwt"

function buildReq(body: Record<string, unknown>, order: Record<string, unknown> | null, createImpl?: jest.Mock) {
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === "review") return { createReviews: createImpl ?? jest.fn().mockResolvedValue({ id: "review_1", status: "pending" }) }
        return { retrieveOrder: jest.fn().mockResolvedValue(order) }
      },
    },
  } as any
}

function buildRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("POST /store/reviews", () => {
  afterEach(() => jest.restoreAllMocks())

  it("returns 400 for an invalid token", async () => {
    const req = buildReq({ token: "invalido", productId: "prod_1", rating: 5 }, null)
    const res = buildRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("returns 400 for a rating outside 1-5", async () => {
    jest.spyOn(reviewJwt, "verifyReviewToken").mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const req = buildReq({ token: "valido", productId: "prod_1", rating: 6 }, { id: "order_1", metadata: { seller_id: "seller_1" }, email: "a@a.com" })
    const res = buildRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("creates a review resolving sellerId from the order, never from the request body", async () => {
    jest.spyOn(reviewJwt, "verifyReviewToken").mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", metadata: { seller_id: "seller_1" }, email: "cliente@teste.com", shipping_address: { first_name: "Maria" } }
    const createSpy = jest.fn().mockResolvedValue({ id: "review_1", status: "pending" })
    const req = buildReq({ token: "valido", productId: "prod_1", rating: 5, comment: "Ótimo", sellerId: "seller-forjado" }, order, createSpy)
    const res = buildRes()

    await POST(req, res)

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order_1",
      productId: "prod_1",
      sellerId: "seller_1",
      rating: 5,
    }))
    expect(res.json).toHaveBeenCalledWith({ review: { id: "review_1", status: "pending" } })
  })

  it("returns 409 when the product was already reviewed for this order", async () => {
    jest.spyOn(reviewJwt, "verifyReviewToken").mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", metadata: { seller_id: "seller_1" }, email: "cliente@teste.com", shipping_address: { first_name: "Maria" } }
    const duplicateError = Object.assign(new Error("duplicate key value"), { code: "23505" })
    const createSpy = jest.fn().mockRejectedValue(duplicateError)
    const req = buildReq({ token: "valido", productId: "prod_1", rating: 5 }, order, createSpy)
    const res = buildRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
  })
})
```

- [ ] **Step 6: Rodar o teste pra confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/reviews/__tests__/route.unit.spec.ts`
Expected: FAIL — a rota não existe ainda.

- [ ] **Step 7: Implementar `POST /store/reviews`**

`packages/medusa-backend/apps/backend/src/api/store/reviews/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { verifyReviewToken } from "../../../utils/review-jwt"
import { REVIEW_MODULE } from "../../../modules/review"
import ReviewModuleService from "../../../modules/review/service"

const BodySchema = z.object({
  token: z.string(),
  productId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const { token, productId, rating, comment } = parsed.data

  let payload
  try {
    payload = verifyReviewToken(token)
  } catch (err) {
    return res.status(400).json({ error: "Link de avaliação inválido ou expirado" })
  }

  const orderService = req.scope.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(payload.orderId, {
    relations: ["shipping_address"],
    select: ["metadata", "email"],
  })
  if (!order) {
    return res.status(400).json({ error: "Pedido não encontrado" })
  }

  const sellerId = (order.metadata as any)?.seller_id
  const reviewerName = (order as any).shipping_address?.first_name ?? "Cliente"

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  try {
    const review = await reviewService.createReviews({
      orderId: payload.orderId,
      productId,
      sellerId,
      rating,
      comment,
      reviewerName,
    })
    res.json({ review: { id: review.id, status: review.status } })
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Você já avaliou este produto" })
    }
    throw err
  }
}
```

- [ ] **Step 8: Rodar o teste pra confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/reviews/__tests__/route.unit.spec.ts`
Expected: PASS (4 testes)

- [ ] **Step 9: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/reviews
git commit -m "feat(review): adiciona rotas públicas de convite e submissão de avaliação"
```

---

### Task 6: `GET /store/products/[id]/reviews` — listagem pública

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/store/products/[id]/reviews/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/products/[id]/reviews/__tests__/route.unit.spec.ts`

**Interfaces:**
- Produces: `{ reviews: Array<{ id, rating, comment, reviewerName, created_at }>, average: number | null, count: number }`.

- [ ] **Step 1: Escrever o teste que falha**

`packages/medusa-backend/apps/backend/src/api/store/products/[id]/reviews/__tests__/route.unit.spec.ts`:

```ts
import { GET } from "../route"

function buildReq(reviews: any[]) {
  return {
    params: { id: "prod_1" },
    query: {},
    scope: { resolve: () => ({ listReviews: jest.fn().mockResolvedValue(reviews) }) },
  } as any
}

function buildRes() {
  const res: any = {}
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("GET /store/products/[id]/reviews", () => {
  it("returns published reviews with the average rating", async () => {
    const reviews = [
      { id: "r1", rating: 5, comment: "Ótimo", reviewerName: "Maria Silva", created_at: "2026-09-01" },
      { id: "r2", rating: 3, comment: null, reviewerName: "João Souza", created_at: "2026-09-02" },
    ]
    const req = buildReq(reviews)
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({
      reviews: [
        { id: "r1", rating: 5, comment: "Ótimo", reviewerName: "Maria S.", created_at: "2026-09-01" },
        { id: "r2", rating: 3, comment: null, reviewerName: "João S.", created_at: "2026-09-02" },
      ],
      average: 4,
      count: 2,
    })
  })

  it("returns average null when there are no published reviews", async () => {
    const req = buildReq([])
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({ reviews: [], average: null, count: 0 })
  })
})
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/products/\[id\]/reviews`
Expected: FAIL — a rota não existe ainda.

- [ ] **Step 3: Implementar**

`packages/medusa-backend/apps/backend/src/api/store/products/[id]/reviews/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../../../modules/review"
import ReviewModuleService from "../../../../../modules/review/service"

function truncateName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params as { id: string }
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  const published = await reviewService.listReviews(
    { productId: id, status: "published" },
    { order: { created_at: "DESC" } }
  )

  const reviews = published.map((r: any) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    reviewerName: truncateName(r.reviewerName),
    created_at: r.created_at,
  }))

  const average =
    reviews.length === 0
      ? null
      : Math.round((reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length) * 10) / 10

  res.json({ reviews, average, count: reviews.length })
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/products/\[id\]/reviews`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/products/\[id\]/reviews
git commit -m "feat(review): adiciona listagem pública de avaliações do produto"
```

---

### Task 7: Rotas do vendedor — `GET /seller/reviews` e `PATCH /seller/reviews/[id]`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/seller/reviews/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/seller/reviews/[id]/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/seller/reviews/__tests__/route.unit.spec.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/seller/reviews/[id]/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `(req as any).sellerId`, já populado pelo `sellerAuth` (matcher `/seller` em `api/middlewares.ts` — sem guarda própria necessária).

- [ ] **Step 1: Escrever o teste de `GET /seller/reviews` que falha**

`packages/medusa-backend/apps/backend/src/api/seller/reviews/__tests__/route.unit.spec.ts`:

```ts
import { GET } from "../route"

function buildReq(sellerId: string, listImpl: jest.Mock) {
  return {
    sellerId,
    query: {},
    scope: { resolve: () => ({ listReviews: listImpl }) },
  } as any
}

function buildRes() {
  const res: any = {}
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("GET /seller/reviews", () => {
  it("filters by the logged-in seller and defaults to pending status", async () => {
    const listSpy = jest.fn().mockResolvedValue([])
    const req = buildReq("seller_1", listSpy)
    const res = buildRes()

    await GET(req, res)

    expect(listSpy).toHaveBeenCalledWith(
      { sellerId: "seller_1", status: "pending" },
      expect.anything()
    )
  })
})
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/seller/reviews/__tests__/route.unit.spec.ts`
Expected: FAIL — a rota não existe ainda.

- [ ] **Step 3: Implementar `GET /seller/reviews`**

`packages/medusa-backend/apps/backend/src/api/seller/reviews/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../modules/review"
import ReviewModuleService from "../../../modules/review/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { status = "pending", limit = 20, offset = 0 } = req.query as Record<string, string>

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const reviews = await reviewService.listReviews(
    { sellerId, status },
    { take: Number(limit), skip: Number(offset), order: { created_at: "DESC" } }
  )

  res.json({ reviews, count: reviews.length })
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/seller/reviews/__tests__/route.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Escrever o teste de `PATCH /seller/reviews/[id]` que falha**

`packages/medusa-backend/apps/backend/src/api/seller/reviews/[id]/__tests__/route.unit.spec.ts`:

```ts
import { PATCH } from "../route"

function buildReq(sellerId: string, id: string, body: Record<string, unknown>, existing: Record<string, unknown> | null, updateImpl?: jest.Mock) {
  return {
    sellerId,
    params: { id },
    body,
    scope: {
      resolve: () => ({
        retrieveReview: jest.fn().mockResolvedValue(existing),
        updateReviews: updateImpl ?? jest.fn().mockResolvedValue({ id, status: body.status }),
      }),
    },
  } as any
}

function buildRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("PATCH /seller/reviews/[id]", () => {
  it("returns 400 for an invalid status", async () => {
    const req = buildReq("seller_1", "review_1", { status: "invalido" }, { id: "review_1", sellerId: "seller_1" })
    const res = buildRes()

    await PATCH(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("returns 404 when the review does not belong to the logged-in seller", async () => {
    const req = buildReq("seller_1", "review_1", { status: "published" }, { id: "review_1", sellerId: "outro-vendedor" })
    const res = buildRes()

    await PATCH(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it("updates the review status when it belongs to the logged-in seller", async () => {
    const updateSpy = jest.fn().mockResolvedValue({ id: "review_1", status: "published" })
    const req = buildReq("seller_1", "review_1", { status: "published" }, { id: "review_1", sellerId: "seller_1" }, updateSpy)
    const res = buildRes()

    await PATCH(req, res)

    expect(updateSpy).toHaveBeenCalledWith({ selector: { id: "review_1" }, data: { status: "published" } })
    expect(res.json).toHaveBeenCalledWith({ review: { id: "review_1", status: "published" } })
  })
})
```

- [ ] **Step 6: Rodar o teste pra confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/seller/reviews/\[id\]`
Expected: FAIL — a rota não existe ainda.

- [ ] **Step 7: Implementar `PATCH /seller/reviews/[id]`**

`packages/medusa-backend/apps/backend/src/api/seller/reviews/[id]/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { REVIEW_MODULE } from "../../../../modules/review"
import ReviewModuleService from "../../../../modules/review/service"

const BodySchema = z.object({
  status: z.enum(["published", "rejected"]),
})

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params as { id: string }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Status inválido" })
  }

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const existing: any = await reviewService.retrieveReview(id)
  if (!existing || existing.sellerId !== sellerId) {
    return res.status(404).json({ error: "Avaliação não encontrada" })
  }

  const [review] = await reviewService.updateReviews({
    selector: { id },
    data: { status: parsed.data.status },
  })

  res.json({ review: { id: review.id, status: review.status } })
}
```

- [ ] **Step 8: Rodar o teste pra confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/seller/reviews`
Expected: PASS (todos)

- [ ] **Step 9: Rodar a suíte completa do backend**

Run: `cd packages/medusa-backend/apps/backend && npx jest`
Expected: PASS, sem regressão.

- [ ] **Step 10: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/seller/reviews
git commit -m "feat(review): adiciona rotas do vendedor pra listar e moderar avaliações"
```

---

### Task 8: Frontend — página `/avaliar/[token]`

**Files:**
- Create: `apps/storefront/src/lib/review-api.ts`
- Create: `apps/storefront/src/app/avaliar/[token]/page.tsx`
- Test: `apps/storefront/src/lib/__tests__/review-api.test.ts`
- Test: `apps/storefront/src/app/avaliar/[token]/__tests__/page.test.tsx`

**Interfaces:**
- Produces: `getReviewInvite(token)`, `submitReview({ token, productId, rating, comment? })` em `review-api.ts` — chamadas públicas, sem cookie/sessão (mesmo `BASE_URL`/`x-publishable-api-key` de `lib/api.ts`, mas em arquivo próprio já que não são nem "store" genérico nem "seller" autenticado).

- [ ] **Step 1: Escrever o teste de `review-api.ts` que falha**

`apps/storefront/src/lib/__tests__/review-api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { getReviewInvite, submitReview } from "../review-api"

describe("review-api", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("getReviewInvite fetches the invite by token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) })
    vi.stubGlobal("fetch", fetchMock)

    await getReviewInvite("tok_1")

    expect(fetchMock.mock.calls[0][0]).toContain("/store/reviews/invite/tok_1")
  })

  it("submitReview posts the rating and comment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ review: { id: "r1", status: "pending" } }) })
    vi.stubGlobal("fetch", fetchMock)

    await submitReview({ token: "tok_1", productId: "prod_1", rating: 5, comment: "Ótimo" })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/store/reviews")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ token: "tok_1", productId: "prod_1", rating: 5, comment: "Ótimo" })
  })
})
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/review-api.test.ts`
Expected: FAIL — `../review-api` não existe ainda.

- [ ] **Step 3: Implementar `review-api.ts`**

`apps/storefront/src/lib/review-api.ts`:

```ts
const BASE_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://localhost:9000"
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ""

async function reviewFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-publishable-api-key": PUB_KEY,
      ...(init?.headers as Record<string, string>),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `API ${res.status}: ${path}`)
  }
  return res.json()
}

export type ReviewInviteItem = {
  productId: string
  title: string
  thumbnail?: string
  alreadyReviewed: boolean
}

export async function getReviewInvite(token: string) {
  return reviewFetch<{ items: ReviewInviteItem[] }>(`/store/reviews/invite/${token}`)
}

export async function submitReview(input: { token: string; productId: string; rating: number; comment?: string }) {
  return reviewFetch<{ review: { id: string; status: string } }>("/store/reviews", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/review-api.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Escrever o teste da página que falha**

`apps/storefront/src/app/avaliar/[token]/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import AvaliarPage from "../page"
import * as reviewApi from "@/lib/review-api"

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "tok_1" }),
}))

describe("AvaliarPage", () => {
  afterEach(() => vi.restoreAllMocks())

  it("lists the reviewable products from the invite", async () => {
    vi.spyOn(reviewApi, "getReviewInvite").mockResolvedValue({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: undefined, alreadyReviewed: false }],
    })

    render(<AvaliarPage />)

    expect(await screen.findByText("Cesta de Vime")).toBeInTheDocument()
  })

  it("shows an already-reviewed product as disabled instead of hiding it", async () => {
    vi.spyOn(reviewApi, "getReviewInvite").mockResolvedValue({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: undefined, alreadyReviewed: true }],
    })

    render(<AvaliarPage />)

    expect(await screen.findByText("Avaliado ✓")).toBeInTheDocument()
  })

  it("submits a rating and comment for a product", async () => {
    vi.spyOn(reviewApi, "getReviewInvite").mockResolvedValue({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: undefined, alreadyReviewed: false }],
    })
    const submitSpy = vi.spyOn(reviewApi, "submitReview").mockResolvedValue({ review: { id: "r1", status: "pending" } })
    const user = userEvent.setup()

    render(<AvaliarPage />)
    await screen.findByText("Cesta de Vime")
    await user.click(screen.getByLabelText("5 estrelas"))
    await user.type(screen.getByLabelText(/Comentário/), "Produto ótimo!")
    await user.click(screen.getByRole("button", { name: "Enviar avaliação" }))

    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith({
      token: "tok_1",
      productId: "prod_1",
      rating: 5,
      comment: "Produto ótimo!",
    }))
  })
})
```

- [ ] **Step 6: Rodar o teste pra confirmar que falha**

Run: `cd apps/storefront && npx vitest run src/app/avaliar`
Expected: FAIL — a página não existe ainda.

- [ ] **Step 7: Implementar a página**

`apps/storefront/src/app/avaliar/[token]/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { getReviewInvite, submitReview, type ReviewInviteItem } from '@/lib/review-api'
import { Star, Loader2, Check } from 'lucide-react'

export default function AvaliarPage() {
  const { token } = useParams<{ token: string }>()
  const [items, setItems] = useState<ReviewInviteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getReviewInvite(token)
      .then((data) => setItems(data.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Erro ao carregar avaliação'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  if (error) {
    return <p className="text-center text-terracotta py-12">{error}</p>
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <h1 className="font-display text-2xl font-black text-onyx">Avalie sua compra</h1>
      {items.map((item) => (
        <ReviewCard
          key={item.productId}
          item={item}
          token={token}
          onSubmitted={() =>
            setItems((prev) =>
              prev.map((i) => (i.productId === item.productId ? { ...i, alreadyReviewed: true } : i))
            )
          }
        />
      ))}
    </div>
  )
}

function ReviewCard({
  item,
  token,
  onSubmitted,
}: {
  item: ReviewInviteItem
  token: string
  onSubmitted: () => void
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setSaving(true)
    try {
      await submitReview({ token, productId: item.productId, rating, comment: comment || undefined })
      onSubmitted()
    } finally {
      setSaving(false)
    }
  }

  if (item.alreadyReviewed) {
    return (
      <div className="bg-white rounded-xl border border-sand-dark p-5 flex items-center gap-3 text-forest">
        <Check className="h-5 w-5" />
        <p className="font-semibold">{item.title}</p>
        <span className="ml-auto text-sm">Avaliado ✓</span>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-sand-dark p-5 space-y-3">
      <p className="font-display font-bold text-onyx">{item.title}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
            onClick={() => setRating(n)}
          >
            <Star className={`h-6 w-6 ${n <= rating ? 'fill-amber text-amber' : 'text-sand-dark'}`} />
          </button>
        ))}
      </div>
      <label className="block text-xs font-semibold text-onyx/60" htmlFor={`comment-${item.productId}`}>
        Comentário (opcional)
      </label>
      <textarea
        id={`comment-${item.productId}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="input min-h-[80px]"
        maxLength={1000}
      />
      <button
        type="button"
        disabled={rating === 0 || saving}
        onClick={handleSubmit}
        className="rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50"
      >
        Enviar avaliação
      </button>
    </div>
  )
}
```

- [ ] **Step 8: Rodar o teste pra confirmar que passa**

Run: `cd apps/storefront && npx vitest run src/app/avaliar`
Expected: PASS (3 testes)

- [ ] **Step 9: Commit**

```bash
git add apps/storefront/src/lib/review-api.ts apps/storefront/src/lib/__tests__/review-api.test.ts apps/storefront/src/app/avaliar
git commit -m "feat(review): adiciona página de avaliação por link assinado"
```

---

### Task 9: Frontend — exibição de avaliações na página do produto

**Files:**
- Modify: `apps/storefront/src/lib/api.ts`
- Create: `apps/storefront/src/components/product/ProductReviews.tsx`
- Modify: `apps/storefront/src/app/produto/[handle]/page.tsx`
- Test: `apps/storefront/src/lib/__tests__/api.test.ts`
- Test: `apps/storefront/src/components/product/__tests__/ProductReviews.test.tsx`

**Interfaces:**
- Consumes: `GET /store/products/{id}/reviews` (Task 6).
- Produces: `getProductReviews(productId)` em `lib/api.ts`; componente `ProductReviews` consumido por `produto/[handle]/page.tsx`.

- [ ] **Step 1: Escrever o teste de `getProductReviews` que falha**

Em `apps/storefront/src/lib/__tests__/api.test.ts`, adicionar (mesmo arquivo/padrão do teste de `getProduct` já existente):

```ts
describe("getProductReviews", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("fetches reviews for the given product id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviews: [], average: null, count: 0 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await getProductReviews("prod_1")

    expect(fetchMock.mock.calls[0][0]).toContain("/store/products/prod_1/reviews")
  })
})
```

Adicionar `getProductReviews` ao import do `getProduct`/`getSellerProducts` no topo do arquivo.

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/api.test.ts`
Expected: FAIL — `getProductReviews` não existe ainda em `lib/api.ts`.

- [ ] **Step 3: Implementar `getProductReviews` em `lib/api.ts`**

Adicionar ao final de `apps/storefront/src/lib/api.ts`:

```ts
export type ProductReview = {
  id: string
  rating: number
  comment: string | null
  reviewerName: string
  created_at: string
}

export async function getProductReviews(productId: string) {
  return apiFetch<{ reviews: ProductReview[]; average: number | null; count: number }>(
    `/store/products/${productId}/reviews`
  )
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/api.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Escrever o teste do componente que falha**

`apps/storefront/src/components/product/__tests__/ProductReviews.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ProductReviews } from "../ProductReviews"

describe("ProductReviews", () => {
  it("shows the average rating and each review", () => {
    render(
      <ProductReviews
        average={4.5}
        count={2}
        reviews={[
          { id: "r1", rating: 5, comment: "Ótimo", reviewerName: "Maria S.", created_at: "2026-09-01T00:00:00Z" },
          { id: "r2", rating: 4, comment: null, reviewerName: "João S.", created_at: "2026-09-02T00:00:00Z" },
        ]}
      />
    )

    expect(screen.getByText("4.5")).toBeInTheDocument()
    expect(screen.getByText("Ótimo")).toBeInTheDocument()
    expect(screen.getByText("Maria S.")).toBeInTheDocument()
  })

  it("shows an empty state when there are no reviews yet", () => {
    render(<ProductReviews average={null} count={0} reviews={[]} />)

    expect(screen.getByText(/Nenhuma avaliação ainda/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Rodar o teste pra confirmar que falha**

Run: `cd apps/storefront && npx vitest run src/components/product/__tests__/ProductReviews.test.tsx`
Expected: FAIL — o componente não existe ainda.

- [ ] **Step 7: Implementar o componente**

`apps/storefront/src/components/product/ProductReviews.tsx`:

```tsx
import { Star } from 'lucide-react'
import type { ProductReview } from '@/lib/api'

type Props = {
  average: number | null
  count: number
  reviews: ProductReview[]
}

export function ProductReviews({ average, count, reviews }: Props) {
  return (
    <section className="mt-10 border-t border-sand-dark pt-8">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="font-display text-xl font-black text-onyx">Avaliações</h2>
        {average !== null && (
          <span className="flex items-center gap-1 text-onyx/70">
            <Star className="h-4 w-4 fill-amber text-amber" />
            {average} <span className="text-onyx/40 text-sm">({count})</span>
          </span>
        )}
      </div>

      {reviews.length === 0 ? (
        <p className="text-onyx/50 text-sm">Nenhuma avaliação ainda — seja o primeiro a avaliar depois da compra.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-xl border border-sand-dark p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`h-3.5 w-3.5 ${n <= review.rating ? 'fill-amber text-amber' : 'text-sand-dark'}`} />
                  ))}
                </div>
                <p className="text-sm font-semibold text-onyx">{review.reviewerName}</p>
              </div>
              {review.comment && <p className="text-onyx/70 text-sm">{review.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 8: Rodar o teste pra confirmar que passa**

Run: `cd apps/storefront && npx vitest run src/components/product/__tests__/ProductReviews.test.tsx`
Expected: PASS (2 testes)

- [ ] **Step 9: Ligar na página do produto**

Em `apps/storefront/src/app/produto/[handle]/page.tsx`, importar `getProductReviews` e `ProductReviews`, buscar em paralelo com `getProduct` (`Promise.all`, sem travar a página se a busca de reviews falhar — `catch` retornando um resultado vazio), e renderizar `<ProductReviews average={...} count={...} reviews={...} />` logo abaixo de `<ProductDetails ... />`:

```tsx
const [{ products }, reviewsData] = await Promise.all([
  getProduct(handle).catch(() => ({ products: [] })),
  getProductReviews(productId).catch(() => ({ reviews: [], average: null, count: 0 })),
])
```

Note que `productId` só existe depois de resolver `product` — ajuste a ordem real das chamadas (buscar `product` primeiro, `reviews` em seguida usando `product.id`) mantendo as duas como `await` sequenciais simples é aceitável aqui; o `Promise.all` acima é ilustrativo de intenção, não uma exigência de paralelismo real, já que a segunda depende do resultado da primeira.

- [ ] **Step 10: Rodar a suíte completa do frontend**

Run: `cd apps/storefront && npx vitest run && npx tsc --noEmit`
Expected: todos os testes PASS, `tsc` sem erros.

- [ ] **Step 11: Commit**

```bash
git add apps/storefront/src/lib/api.ts apps/storefront/src/lib/__tests__/api.test.ts apps/storefront/src/components/product/ProductReviews.tsx apps/storefront/src/components/product/__tests__/ProductReviews.test.tsx apps/storefront/src/app/produto/\[handle\]/page.tsx
git commit -m "feat(review): exibe avaliações publicadas na página do produto"
```

---

### Task 10: Frontend — aba "Avaliações" no painel do vendedor

**Files:**
- Modify: `apps/storefront/src/lib/seller-api.ts`
- Modify: `apps/storefront/src/app/painel/layout.tsx`
- Create: `apps/storefront/src/app/painel/avaliacoes/page.tsx`
- Test: `apps/storefront/src/lib/__tests__/seller-api.test.ts`
- Test: `apps/storefront/src/app/painel/avaliacoes/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `GET /seller/reviews`, `PATCH /seller/reviews/{id}` (Task 7).
- Produces: `getSellerReviews()`, `updateReviewStatus(id, status)` em `seller-api.ts`.

- [ ] **Step 1: Escrever o teste de `seller-api.ts` que falha**

Em `apps/storefront/src/lib/__tests__/seller-api.test.ts`, adicionar (mesmo padrão de `getSellerProducts` já testado ali):

```ts
describe("getSellerReviews", () => {
  it("fetches pending reviews by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reviews: [] }) })
    vi.stubGlobal("fetch", fetchMock)

    await getSellerReviews()

    expect(fetchMock.mock.calls[0][0]).toContain("/seller/reviews")
    vi.unstubAllGlobals()
  })
})

describe("updateReviewStatus", () => {
  it("patches the review status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ review: { id: "r1", status: "published" } }) })
    vi.stubGlobal("fetch", fetchMock)

    await updateReviewStatus("r1", "published")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/seller/reviews/r1")
    expect(init.method).toBe("PATCH")
    vi.unstubAllGlobals()
  })
})
```

Adicionar `getSellerReviews`, `updateReviewStatus` ao import do teste.

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/seller-api.test.ts`
Expected: FAIL — as funções não existem ainda.

- [ ] **Step 3: Implementar em `seller-api.ts`**

Adicionar ao final de `apps/storefront/src/lib/seller-api.ts`:

```ts
export async function getSellerReviews(params?: { status?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams()
  qs.set("status", params?.status ?? "pending")
  qs.set("limit", String(params?.limit ?? 20))
  qs.set("offset", String(params?.offset ?? 0))
  return sellerFetch<{ reviews: unknown[]; count: number }>(`/seller/reviews?${qs}`)
}

export async function updateReviewStatus(id: string, status: 'published' | 'rejected') {
  return sellerFetch<{ review: { id: string; status: string } }>(`/seller/reviews/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/seller-api.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Adicionar a entrada de navegação**

Em `apps/storefront/src/app/painel/layout.tsx`, no array `navItems`, adicionar (entre "Comissões" e "Meu perfil", ou na ordem que fizer mais sentido visualmente) usando o ícone `Star` de `lucide-react` (já usado nas Tasks 8-9):

```ts
{ href: '/painel/avaliacoes', label: 'Avaliações', icon: Star },
```

Lembrar de importar `Star` no topo do arquivo, junto dos outros ícones de `lucide-react`.

- [ ] **Step 6: Escrever o teste da página que falha**

`apps/storefront/src/app/painel/avaliacoes/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AvaliacoesPage from "../page"
import * as sellerApi from "@/lib/seller-api"

describe("AvaliacoesPage", () => {
  it("lists pending reviews and approves one", async () => {
    vi.spyOn(sellerApi, "getSellerReviews").mockResolvedValue({
      reviews: [{ id: "r1", productId: "prod_1", rating: 5, comment: "Ótimo", reviewerName: "Maria S.", created_at: "2026-09-01" }],
      count: 1,
    })
    const updateSpy = vi.spyOn(sellerApi, "updateReviewStatus").mockResolvedValue({ review: { id: "r1", status: "published" } })

    render(<AvaliacoesPage />)

    expect(await screen.findByText("Ótimo")).toBeInTheDocument()
    const user = (await import("@testing-library/user-event")).default.setup()
    await user.click(screen.getByRole("button", { name: "Aprovar" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("r1", "published"))
  })

  it("shows an empty state with no pending reviews", async () => {
    vi.spyOn(sellerApi, "getSellerReviews").mockResolvedValue({ reviews: [], count: 0 })

    render(<AvaliacoesPage />)

    expect(await screen.findByText(/Nenhuma avaliação pendente/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Rodar o teste pra confirmar que falha**

Run: `cd apps/storefront && npx vitest run src/app/painel/avaliacoes`
Expected: FAIL — a página não existe ainda.

- [ ] **Step 8: Implementar a página**

`apps/storefront/src/app/painel/avaliacoes/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { getSellerReviews, updateReviewStatus } from '@/lib/seller-api'
import { Loader2, Star, Check, X } from 'lucide-react'

type Review = {
  id: string
  productId: string
  rating: number
  comment: string | null
  reviewerName: string
  created_at: string
}

export default function AvaliacoesPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await getSellerReviews()
      setReviews(data.reviews as Review[])
    } finally {
      setLoading(false)
    }
  }

  async function act(id: string, status: 'published' | 'rejected') {
    setActingId(id)
    try {
      await updateReviewStatus(id, status)
      setReviews((prev) => prev.filter((r) => r.id !== id))
    } finally {
      setActingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black text-onyx">Avaliações</h1>
        <p className="text-onyx/50 text-sm mt-1">Aprove ou rejeite avaliações antes de publicá-las</p>
      </div>

      {reviews.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-dark p-12 text-center">
          <Star className="h-12 w-12 text-onyx/20 mx-auto mb-4" />
          <p className="font-display font-bold text-onyx">Nenhuma avaliação pendente</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-xl border border-sand-dark p-5">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`h-4 w-4 ${n <= review.rating ? 'fill-amber text-amber' : 'text-sand-dark'}`} />
                ))}
              </div>
              {review.comment && <p className="text-onyx/70 text-sm mt-2">{review.comment}</p>}
              <p className="text-xs text-onyx/40 mt-1">{review.reviewerName}</p>
              <div className="flex gap-2 mt-3">
                <button
                  disabled={actingId === review.id}
                  onClick={() => act(review.id, 'published')}
                  className="flex items-center gap-1 rounded-lg bg-forest/10 text-forest px-3 py-1.5 text-sm font-semibold hover:bg-forest/20 transition-colors disabled:opacity-50"
                >
                  <Check className="h-4 w-4" /> Aprovar
                </button>
                <button
                  disabled={actingId === review.id}
                  onClick={() => act(review.id, 'rejected')}
                  className="flex items-center gap-1 rounded-lg bg-terracotta/10 text-terracotta px-3 py-1.5 text-sm font-semibold hover:bg-terracotta/20 transition-colors disabled:opacity-50"
                >
                  <X className="h-4 w-4" /> Rejeitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 9: Rodar o teste pra confirmar que passa**

Run: `cd apps/storefront && npx vitest run src/app/painel/avaliacoes`
Expected: PASS (2 testes)

- [ ] **Step 10: Rodar a suíte completa do frontend e o typecheck**

Run: `cd apps/storefront && npx vitest run && npx tsc --noEmit`
Expected: todos os testes PASS, `tsc` sem erros.

- [ ] **Step 11: Commit**

```bash
git add apps/storefront/src/lib/seller-api.ts apps/storefront/src/lib/__tests__/seller-api.test.ts apps/storefront/src/app/painel/layout.tsx apps/storefront/src/app/painel/avaliacoes
git commit -m "feat(review): adiciona aba de moderação de avaliações no painel do vendedor"
```

---

## Self-Review Notes

- **Spec coverage**: módulo/model (Task 1), token (Task 2), e-mail compartilhado (Task 3), subscriber (Task 4), submissão pública (Task 5), listagem pública (Task 6), moderação do vendedor (Task 7), tela de avaliação (Task 8), exibição no produto (Task 9), aba do painel (Task 10) — toda seção do design tem uma task.
- **Restrição de segurança do Global Constraints** (sellerId nunca vem do corpo do comprador) está testada explicitamente na Task 5, Step 5 (`sellerId: "seller-forjado"` no corpo, asserção de que o valor usado foi o do pedido).
- **Consistência de tipos**: `ReviewInviteItem`/`ProductReview` definidos uma vez (Tasks 8 e 9) e usados em todo import subsequente; `getSellerReviews`/`updateReviewStatus` (Task 10) têm a mesma assinatura usada pela página `avaliacoes/page.tsx` no mesmo task.
- **Placeholder scan**: nenhum "TBD"/"implementar depois". Dois erros reais foram encontrados e corrigidos nesta auto-revisão antes de fechar o plano: o teste do service (Task 1) não mockava `MedusaService` (teria tentado inicializar conexão real com o banco, como o de `seller` evita) — corrigido pra seguir o mesmo padrão de `modules/seller/__tests__/service.unit.spec.ts`; e o teste de `sendBrevoEmail` (Task 3) usava uma env var de sandbox inventada (`SANDBOX_MODE`) em vez da real (`MARKETPLACE_SANDBOX`, que fica ligada por padrão) — corrigido, com um teste a mais cobrindo o comportamento padrão de sandbox ligado.
- O único ponto que ainda exige confirmação em tempo de implementação (nome exato do campo reverso em `query.graph` na Task 5, entre `product.id` e uma alternativa de sintaxe) está marcado como tal, não como código pronto — mesmo padrão de hedge já usado no spec de split de pedido por vendedor deste repo.
