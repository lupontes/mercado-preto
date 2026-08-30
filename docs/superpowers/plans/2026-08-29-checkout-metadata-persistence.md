# Persistência de Metadados do Checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O webhook de pagamento aprovado do MercadoPago recupera os metadados do checkout (itens, endereço, frete, `seller_id`, documento do comprador) a partir do nosso próprio banco de dados, em vez de depender da busca de preferências do MercadoPago — que tem atraso de indexação medido em horas e falha silenciosamente em checkouts reais.

**Architecture:** Novo módulo Medusa `checkout` com um único model (`checkout_snapshot`), gravado pela rota `store/checkout/preference` no momento da criação da preferência MP (antes de chamar a API do MercadoPago) e lido pelo webhook `webhooks/mercadopago` como primeira fonte de fallback quando `payment.metadata` vier vazio. A busca de preferência no MercadoPago continua existindo como último recurso (preferências criadas antes deste deploy). Se nenhuma das três fontes tiver itens, o webhook não cria pedido — loga erro em vez de criar um pedido vazio silenciosamente.

**Tech Stack:** Medusa v2 (`@medusajs/framework`), TypeScript, Jest (`npm run test:unit` a partir de `packages/medusa-backend/apps/backend`), PostgreSQL via MikroORM raw-SQL migrations (convenção já estabelecida no projeto — não usar `medusa db:generate`).

**Spec:** `docs/superpowers/specs/2026-08-29-checkout-metadata-persistence-design.md`

## Global Constraints

- Migrations são SQL raw escrito à mão em `src/modules/<module>/migrations/Migration<timestamp>.ts`, seguindo o padrão exato dos módulos `commission` e `fiscal` já existentes — não rodar `medusa db:generate`.
- O registro `checkout_snapshot` nunca é apagado nem expira — é trilha de auditoria permanente (decisão do usuário no design).
- Gravar o snapshot é uma condição bloqueante: se falhar, a rota de criação de preferência responde `500` e **não chama a API do MercadoPago**.
- Atualizar o snapshot com o `preferenceId` (depois que a preferência é criada) é best-effort: se falhar, loga aviso mas a resposta ao frontend continua sendo sucesso.
- A busca de preferência no MercadoPago (comportamento atual) é mantida como fallback de último recurso — nunca removida, só reordenada para depois da consulta ao nosso banco.
- Mensagens de commit em português, Conventional Commits, imperativo, minúsculo, sem ponto final (padrão do usuário).

---

### Task 1: Módulo `checkout` — model, service e migration

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/modules/checkout/models/checkout-snapshot.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/checkout/service.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/checkout/index.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/checkout/migrations/Migration20260829223000.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/checkout/__tests__/service.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/medusa-config.ts`

**Interfaces:**
- Produces: `CHECKOUT_MODULE` (string constante, valor `"checkout"`) exportado de `src/modules/checkout/index.ts` — usado pelas Tasks 2 e 3 para `req.scope.resolve(CHECKOUT_MODULE)`.
- Produces: `CheckoutModuleService` (default export de `src/modules/checkout/service.ts`) com os métodos:
  - `recordSnapshot(externalReference: string, payload: Record<string, unknown>): Promise<unknown>`
  - `findByExternalReference(externalReference: string): Promise<{ id: string; payload: Record<string, unknown> } | null>`
  - `attachPreferenceId(externalReference: string, preferenceId: string): Promise<void>`

- [ ] **Step 1: Escrever o teste falho do model/service**

Crie `packages/medusa-backend/apps/backend/src/modules/checkout/__tests__/service.unit.spec.ts`:

```ts
// ---------------------------------------------------------------------------
// Mock @medusajs/framework/utils BEFORE importing the service.
// Spread the real module so that `model`, `Module`, etc. remain intact —
// only MedusaService is replaced to avoid database initialization.
// ---------------------------------------------------------------------------
jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        createCheckoutSnapshots = jest.fn()
        listCheckoutSnapshots = jest.fn()
        updateCheckoutSnapshots = jest.fn()
      },
  }
})

import CheckoutModuleService from "../service"

function makeService() {
  const svc = new CheckoutModuleService() as any
  return svc as CheckoutModuleService & {
    createCheckoutSnapshots: jest.Mock
    listCheckoutSnapshots: jest.Mock
    updateCheckoutSnapshots: jest.Mock
  }
}

describe("CheckoutModuleService.recordSnapshot", () => {
  it("creates a checkout_snapshot with the given externalReference and payload", async () => {
    const svc = makeService()
    svc.createCheckoutSnapshots.mockResolvedValue({ id: "snap_1" })

    const payload = {
      items: [{ title: "Camiseta", quantity: 1, price: 7900 }],
      address: { first_name: "João" },
      shipping: { id: "pac", name: "PAC", price: 2500 },
      total: 10400,
    }
    await svc.recordSnapshot("ext-ref-1", payload)

    expect(svc.createCheckoutSnapshots).toHaveBeenCalledWith({
      externalReference: "ext-ref-1",
      payload,
    })
  })
})

describe("CheckoutModuleService.findByExternalReference", () => {
  it("returns the snapshot matching the external reference", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([{ id: "snap_1", externalReference: "ext-ref-1" }])

    const result = await svc.findByExternalReference("ext-ref-1")

    expect(svc.listCheckoutSnapshots).toHaveBeenCalledWith({ externalReference: "ext-ref-1" })
    expect(result).toEqual({ id: "snap_1", externalReference: "ext-ref-1" })
  })

  it("returns null when no snapshot matches", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([])

    const result = await svc.findByExternalReference("missing-ref")

    expect(result).toBeNull()
  })
})

describe("CheckoutModuleService.attachPreferenceId", () => {
  it("updates the snapshot's preferenceId when the snapshot exists", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([{ id: "snap_1", externalReference: "ext-ref-1" }])
    svc.updateCheckoutSnapshots.mockResolvedValue([{}])

    await svc.attachPreferenceId("ext-ref-1", "pref-abc")

    expect(svc.updateCheckoutSnapshots).toHaveBeenCalledWith({ id: "snap_1", preferenceId: "pref-abc" })
  })

  it("does nothing when no snapshot matches the external reference", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([])

    await svc.attachPreferenceId("missing-ref", "pref-abc")

    expect(svc.updateCheckoutSnapshots).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/modules/checkout/__tests__/service.unit.spec.ts`
Expected: FAIL — `Cannot find module '../service'` (o arquivo ainda não existe).

- [ ] **Step 3: Criar o model**

Crie `packages/medusa-backend/apps/backend/src/modules/checkout/models/checkout-snapshot.ts`:

```ts
import { model } from "@medusajs/framework/utils"

const CheckoutSnapshot = model.define("checkout_snapshot", {
  id: model.id().primaryKey(),
  externalReference: model.text().unique(),
  payload: model.json(),
  preferenceId: model.text().nullable(),
})

export default CheckoutSnapshot
```

- [ ] **Step 4: Criar o service**

Crie `packages/medusa-backend/apps/backend/src/modules/checkout/service.ts`:

```ts
import { MedusaService } from "@medusajs/framework/utils"
import CheckoutSnapshot from "./models/checkout-snapshot"

class CheckoutModuleService extends MedusaService({ CheckoutSnapshot }) {
  async recordSnapshot(externalReference: string, payload: Record<string, unknown>) {
    return this.createCheckoutSnapshots({ externalReference, payload } as any)
  }

  async findByExternalReference(externalReference: string): Promise<any | null> {
    const [snapshot] = await this.listCheckoutSnapshots({ externalReference } as any)
    return snapshot ?? null
  }

  async attachPreferenceId(externalReference: string, preferenceId: string): Promise<void> {
    const snapshot = await this.findByExternalReference(externalReference)
    if (!snapshot) return
    await this.updateCheckoutSnapshots({ id: snapshot.id, preferenceId } as any)
  }
}

export default CheckoutModuleService
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/modules/checkout/__tests__/service.unit.spec.ts`
Expected: PASS (5 testes)

- [ ] **Step 6: Criar o `index.ts` do módulo**

Crie `packages/medusa-backend/apps/backend/src/modules/checkout/index.ts`:

```ts
import { Module } from "@medusajs/framework/utils"
import CheckoutModuleService from "./service"

export const CHECKOUT_MODULE = "checkout"

export default Module(CHECKOUT_MODULE, {
  service: CheckoutModuleService,
})
```

- [ ] **Step 7: Criar a migration**

Crie `packages/medusa-backend/apps/backend/src/modules/checkout/migrations/Migration20260829223000.ts`:

```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260829223000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "checkout_snapshot" ("id" text not null, "externalReference" text not null, "payload" jsonb not null, "preferenceId" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "checkout_snapshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_snapshot_deleted_at" ON "checkout_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_checkout_snapshot_external_reference_unique" ON "checkout_snapshot" ("externalReference") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "checkout_snapshot" cascade;`);
  }

}
```

- [ ] **Step 8: Registrar o módulo em `medusa-config.ts`**

Em `packages/medusa-backend/apps/backend/medusa-config.ts`, dentro do array `modules:`, logo depois do bloco do módulo `fiscal` (que termina com `},` antes do comentário `// File storage`), adicione:

```ts
    // Checkout module — persiste um snapshot dos metadados do checkout
    // (itens, endereço, frete, seller_id) no momento da criação da
    // preferência MP, pra o webhook não depender da busca de preferências
    // do MercadoPago (observada com atraso de indexação de horas).
    {
      resolve: "./src/modules/checkout",
    },

```

- [ ] **Step 9: Rodar a migration no banco de desenvolvimento local**

Run: `cd packages/medusa-backend/apps/backend && npx medusa db:migrate 2>&1 | tail -20`
Expected: `checkout_snapshot` listado entre as migrations aplicadas, sem erro.

- [ ] **Step 10: Rodar a suíte completa do backend (checar regressão)**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit`
Expected: PASS — todos os testes existentes continuam passando, mais os 5 novos de `checkout/__tests__/service.unit.spec.ts`.

- [ ] **Step 11: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/checkout packages/medusa-backend/apps/backend/medusa-config.ts
git commit -m "feat(checkout): adiciona módulo de persistência de snapshot do checkout"
```

---

### Task 2: `checkout/preference/route.ts` grava o snapshot antes de criar a preferência

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `CHECKOUT_MODULE` e `CheckoutModuleService` da Task 1 (`recordSnapshot`, `attachPreferenceId`).
- Produces: nenhuma interface nova consumida por outras tasks — a Task 3 só depende do que a Task 1 já produziu.

- [ ] **Step 1: Atualizar o helper `makeReq` do teste pra suportar `req.scope` (necessário antes de qualquer novo teste, já que a rota hoje nunca usa `req.scope`)**

Em `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/__tests__/route.unit.spec.ts`, substitua o topo do arquivo (linhas 1-25) por:

```ts
import { MercadoPagoConfig, Preference } from "mercadopago"
import { CHECKOUT_MODULE } from "../../../../../modules/checkout"

jest.mock("mercadopago")
jest.mock("crypto", () => ({ randomUUID: () => "fixed-uuid-1234" }))

const MockPreference = Preference as jest.MockedClass<typeof Preference>

import { POST } from "../route"

const makeReq = (
  body: unknown,
  env: Record<string, string> = {},
  checkoutServiceOverrides: Record<string, unknown> = {}
) => {
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-token",
    STORE_CORS: "http://localhost:3000",
    BACKEND_URL: "",
    ...env,
  })
  const mockCheckoutService = {
    recordSnapshot: jest.fn().mockResolvedValue(undefined),
    attachPreferenceId: jest.fn().mockResolvedValue(undefined),
    ...checkoutServiceOverrides,
  }
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return mockLogger
        if (key === CHECKOUT_MODULE) return mockCheckoutService
        throw new Error(`Unexpected resolve: ${key}`)
      },
    },
    _checkoutService: mockCheckoutService,
    _logger: mockLogger,
  } as any
}
```

Isso não muda nenhuma asserção dos testes já existentes — só faz `req.scope.resolve(...)` funcionar sem lançar exceção, já que todos os mocks de `checkoutService` têm sucesso por padrão.

- [ ] **Step 2: Escrever os testes falhos pro novo comportamento**

Adicione ao final do `describe("POST /store/checkout/preference", ...)`, antes do `})` de fechamento:

```ts
  it("writes a checkout snapshot keyed by the generated external_reference before creating the preference", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const req = makeReq(validBody)
    await POST(req, makeRes())

    expect(req._checkoutService.recordSnapshot).toHaveBeenCalledWith(
      "fixed-uuid-1234",
      expect.objectContaining({
        seller_id: "seller-1",
        buyer_document: "11144477735",
        items: [expect.objectContaining({ title: "Camiseta", quantity: 1, price: 7900 })],
        shipping: { id: "pac", name: "PAC", price: 2500 },
        total: 10400,
      })
    )
    const recordCallOrder = req._checkoutService.recordSnapshot.mock.invocationCallOrder[0]
    const createCallOrder = mockPreferenceCreate.mock.invocationCallOrder[0]
    expect(recordCallOrder).toBeLessThan(createCallOrder)
  })

  it("returns 500 and does not call MercadoPago when the snapshot write fails", async () => {
    const req = makeReq(validBody, {}, {
      recordSnapshot: jest.fn().mockRejectedValue(new Error("db down")),
    })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(500)
    expect(mockPreferenceCreate).not.toHaveBeenCalled()
  })

  it("attaches the returned preference_id to the snapshot after creation succeeds", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-xyz" })

    const req = makeReq(validBody)
    await POST(req, makeRes())

    expect(req._checkoutService.attachPreferenceId).toHaveBeenCalledWith("fixed-uuid-1234", "pref-xyz")
  })

  it("still responds success when attaching the preference_id to the snapshot fails (best-effort, non-fatal)", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-xyz" })
    const req = makeReq(validBody, {}, {
      attachPreferenceId: jest.fn().mockRejectedValue(new Error("db down")),
    })

    const res = makeRes()
    await POST(req, res)

    expect(res._status).toBe(200)
    expect(res._body).toEqual(expect.objectContaining({ preference_id: "pref-xyz" }))
  })
```

- [ ] **Step 3: Rodar os testes e confirmar que os 4 novos falham (e os antigos continuam passando)**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/checkout/preference/__tests__/route.unit.spec.ts`
Expected: os testes antigos passam; os 4 novos falham porque `route.ts` ainda não chama `recordSnapshot`/`attachPreferenceId`.

- [ ] **Step 4: Implementar a gravação do snapshot em `route.ts`**

Em `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`, adicione o import no topo (depois do import de `validateDocument`):

```ts
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"
```

Substitua o trecho a partir de `const externalReference = crypto.randomUUID()` (linha 55) até o fim do `try` de `preference.create()` (linha 133, o `})` que fecha a chamada) por:

```ts
  const externalReference = crypto.randomUUID()

  const checkoutSnapshotPayload = {
    seller_id: sellerId,
    buyer_document: buyerDocument,
    address: {
      first_name: address.firstName,
      last_name: address.lastName,
      email: address.email,
      phone: address.phone ?? "",
      address_1: address.address1,
      address_2: address.address2 ?? "",
      city: address.city,
      state: address.state,
      postal_code: address.cep.replace(/\D/g, ""),
    },
    items: items.map((i) => ({
      variant_id: i.variantId,
      title: i.title,
      quantity: i.quantity,
      price: i.price,
    })),
    shipping: { id: shipping.id, name: shipping.name, price: shipping.price },
    total,
  }

  const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)

  try {
    await checkoutService.recordSnapshot(externalReference, checkoutSnapshotPayload)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return res.status(500).json({ error: "Erro ao salvar snapshot do checkout.", detail: msg })
  }

  const mp = new MercadoPagoConfig({ accessToken })
  const preference = new Preference(mp)

  try {
    const result = await preference.create({
      body: {
        items: [
          ...items.map((item) => ({
            id: item.variantId ?? item.title.toLowerCase().replace(/\s+/g, "-"),
            title: item.title,
            quantity: item.quantity,
            unit_price: item.price / 100,
            currency_id: "BRL",
          })),
          ...(shipping.price > 0
            ? [
                {
                  id: `frete-${shipping.id}`,
                  title: `Frete — ${shipping.name}`,
                  quantity: 1,
                  unit_price: shipping.price / 100,
                  currency_id: "BRL",
                },
              ]
            : []),
        ],
        payer: {
          name: address.firstName,
          surname: address.lastName,
          email: address.email,
          phone: address.phone ? { number: address.phone } : undefined,
          address: {
            street_name: address.address1,
            street_number: address.address2 ?? "",
            zip_code: address.cep.replace(/\D/g, ""),
          },
        },
        payment_methods: {
          installments: 12,
        },
        back_urls: {
          success: `${storeCors}/checkout/sucesso`,
          failure: `${storeCors}/checkout/erro`,
          pending: `${storeCors}/checkout/pendente`,
        },
        ...(storeCors.startsWith("https") ? { auto_return: "approved" } : {}),
        statement_descriptor: "MERCADO PRETO",
        external_reference: externalReference,
        // notification_url só funciona com URL pública (HTTPS). Em desenvolvimento local,
        // configure BACKEND_URL com uma URL de túnel (ex: ngrok) para receber webhooks.
        ...(backendUrl ? { notification_url: `${backendUrl}/webhooks/mercadopago` } : {}),
        // Snapshot do pedido pra rastreabilidade via webhook — mesmo payload
        // gravado no nosso banco acima (checkoutSnapshotPayload), fonte de
        // verdade primária caso payment.metadata volte vazio.
        metadata: checkoutSnapshotPayload,
      },
    })

    try {
      await checkoutService.attachPreferenceId(externalReference, result.id as string)
    } catch (attachErr: unknown) {
      const logger = req.scope.resolve("logger") as { warn: (msg: string) => void }
      logger.warn(`[checkout/preference] falha ao gravar preferenceId no snapshot: ${attachErr}`)
    }
```

O `catch` final do `try` de `preference.create()` (que responde `500` com `"Erro ao criar preferência MercadoPago."`) e o `res.json({...})` de sucesso continuam exatamente como estavam — só o conteúdo do `try` acima deles muda.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/store/checkout/preference/__tests__/route.unit.spec.ts`
Expected: PASS — todos os testes (os já existentes + os 4 novos).

- [ ] **Step 6: Rodar a suíte completa do backend (checar regressão)**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts packages/medusa-backend/apps/backend/src/api/store/checkout/preference/__tests__/route.unit.spec.ts
git commit -m "feat(checkout): grava snapshot do checkout antes de criar a preferência MP"
```

---

### Task 3: `webhooks/mercadopago/route.ts` lê o snapshot em vez de depender só da busca do MercadoPago

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `CHECKOUT_MODULE` e `CheckoutModuleService.findByExternalReference` da Task 1.

- [ ] **Step 1: Atualizar o helper `makeReq` do teste pra resolver o `checkout` module**

Em `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`, na função `makeReq` (linhas 38-72), adicione um mock do checkout service e a resolução dele no `scope`:

```ts
function makeReq(body: unknown, secret = WEBHOOK_TEST_SECRET) {
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret

  const mockOrderService = {
    createOrders: jest.fn().mockResolvedValue([{ id: "order-1" }]),
    listOrders: jest.fn().mockResolvedValue([]),
  }
  const mockEventBusService = {
    emit: jest.fn().mockResolvedValue(undefined),
  }
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  const mockCheckoutService = {
    findByExternalReference: jest.fn().mockResolvedValue(null),
  }

  const dataId = (body as any)?.data?.id ?? ""

  return {
    body,
    query: { "data.id": dataId },
    headers: secret ? makeValidSignature(dataId, secret) : {},
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return mockLogger
        if (key === "checkout") return mockCheckoutService
        if (key.includes("order")) return mockOrderService
        if (key.includes("event")) return mockEventBusService
        return {}
      },
    },
    _orderService: mockOrderService,
    _eventBusService: mockEventBusService,
    _checkoutService: mockCheckoutService,
  } as any
}
```

O padrão (`findByExternalReference` resolvendo `null` por padrão) preserva o comportamento de todos os testes já existentes, que exercitam o fallback de busca no MercadoPago — só quando um teste sobrescrever `req._checkoutService.findByExternalReference` é que o snapshot local passa a "existir".

- [ ] **Step 2: Escrever o teste falho pro caminho feliz do snapshot**

Adicione, depois do teste `"uses payment.metadata directly when it already has items"` (linha 189):

```ts
  it("creates order using the local checkout snapshot when payment.metadata has no items (does not call MercadoPago's preference search)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._checkoutService.findByExternalReference.mockResolvedValue({ payload: preferenceMetadata })

    await POST(req, makeRes())

    expect(mockPrefSearch).not.toHaveBeenCalled()
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: [expect.objectContaining({ title: "Camiseta", quantity: 1, unit_price: 7900 })],
        }),
      ])
    )
  })
```

- [ ] **Step 3: Atualizar os dois testes que hoje esperam um pedido vazio (esse é o bug que estamos corrigindo)**

Substitua o teste `"creates order with empty items when preference fetch fails"` (linhas 229-241) por:

```ts
  it("does not create an order when metadata recovery fails via preference search error (refuses instead of creating an empty order)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockRejectedValue(new Error("MP unavailable"))

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()
    await POST(req, res)

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })
```

Substitua o teste `"creates order with empty items when preference search returns no results"` (linhas 243-256) por:

```ts
  it("does not create an order when preference search returns no results (refuses instead of creating an empty order)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [] })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()
    await POST(req, res)

    expect(mockPrefGet).not.toHaveBeenCalled()
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })
```

- [ ] **Step 4: Rodar os testes e confirmar as falhas esperadas**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`
Expected: o teste novo do snapshot falha (rota ainda não consulta o `checkout` module); os dois testes atualizados falham (rota ainda cria pedido vazio); os demais continuam passando.

- [ ] **Step 5: Implementar a leitura do snapshot e a recusa de pedido vazio em `route.ts`**

Em `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts`, adicione o import no topo (depois do import de `mercadopago`):

```ts
import { CHECKOUT_MODULE } from "../../../modules/checkout"
import type CheckoutModuleService from "../../../modules/checkout/service"
```

Substitua o bloco a partir de `// MP does not propagate preference.metadata to the payment object.` (linha 122) até `const shipping: { name: string; price: number } | undefined = meta?.shipping` (linha 145) por:

```ts
      const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)

      // MP does not propagate preference.metadata to the payment object.
      // Recupera o snapshot do checkout: prioriza nosso próprio banco (gravado
      // no momento da criação da preferência, sempre disponível de imediato)
      // em vez de depender da busca de preferências do MercadoPago, que foi
      // observada com atraso de indexação de horas (ver
      // docs/superpowers/specs/2026-08-29-checkout-metadata-persistence-design.md).
      let meta = payment.metadata as Record<string, any> | undefined
      if ((!meta?.items?.length) && payment.external_reference) {
        const snapshot = await checkoutService.findByExternalReference(payment.external_reference)
        if (snapshot) {
          meta = snapshot.payload as Record<string, any>
          logger.info(`[mercadopago/webhook] metadados recuperados do snapshot local para ref ${payment.external_reference}`)
        } else {
          // Fallback legado: preferências criadas antes deste snapshot existir.
          try {
            const prefClient = new Preference(mp)
            const searchResult = await prefClient.search({
              options: { external_reference: payment.external_reference },
            })
            const prefId = searchResult.elements?.[0]?.id
            if (prefId) {
              const pref = await prefClient.get({ preferenceId: prefId })
              meta = pref.metadata as Record<string, any> | undefined
              logger.info(`[mercadopago/webhook] metadados recuperados da preferência ${prefId} (fallback legado)`)
            }
          } catch (prefErr) {
            logger.warn(`[mercadopago/webhook] falha ao buscar preferência (fallback legado): ${prefErr}`)
          }
        }
      }

      const addr = meta?.address as Record<string, string> | undefined
      const mpItems: { variant_id?: string; title: string; quantity: number; price: number }[] =
        meta?.items ?? []
      const shipping: { name: string; price: number } | undefined = meta?.shipping

      if (mpItems.length === 0) {
        logger.error(
          `[mercadopago/webhook] metadados do checkout não recuperados (payment.metadata vazio, snapshot ausente, busca de preferência sem resultado) — pedido NÃO criado pra ref ${payment.external_reference}, payment ${payment.id}`
        )
        return res.sendStatus(200)
      }
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `cd packages/medusa-backend/apps/backend && npx jest src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`
Expected: PASS — todos os testes (os já existentes, os 2 atualizados, o 1 novo).

- [ ] **Step 7: Rodar a suíte completa do backend (checar regressão)**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts
git commit -m "fix(checkout): webhook lê snapshot local antes de depender da busca de preferência MP"
```

---

### Task 4: Deploy e verificação manual no servidor de teste

**Files:** nenhum arquivo de código — só deploy e verificação.

**Interfaces:**
- Consumes: o sistema completo, pós-deploy das Tasks 1-3.
- Produces: confirmação de que um checkout real (minutos entre criar preferência e pagar, não horas) gera pedido com itens mesmo quando `payment.metadata` vem vazio.

- [ ] **Step 1: Push da branch e deploy no servidor de teste**

```bash
git push origin fix/checkout-metadata-persistence
```

Depois, via SSH (`ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67`, diretório `/home/ubuntu/marketplace`): `git fetch && git checkout fix/checkout-metadata-persistence && git pull`, depois rebuild do container `medusa` (`cd infra && docker compose -f docker-compose.prod.yml build medusa && docker compose -f docker-compose.prod.yml up -d medusa`) e rodar a migration nova dentro do container antes ou depois do restart (`docker exec mercado-preto-api npx medusa db:migrate`).

**Atenção:** antes de rebuildar, checar `free -h` no servidor — se o `netdata` estiver consumindo muita memória de novo (>5GB), reiniciar com `sudo systemctl restart netdata` antes do build, senão o build trava por horas sem erro (já aconteceu nesta mesma investigação).

- [ ] **Step 2: Checkout real, rápido, ponta a ponta**

No storefront de teste, montar carrinho, ir direto pro checkout e pagar com cartão de teste (`4235 6477 2802 5682`, CVV `123`, validade `11/30`, titular `APRO APRO`, CPF `123.456.789-09`) — o mais rápido possível (minutos, não horas), simulando um checkout real.

- [ ] **Step 3: Confirmar via banco que o pedido tem itens e que veio do snapshot**

```bash
ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67 "docker exec mercado-preto-db psql -U medusa -d mercado_preto -c \"select id, metadata->>'mercadopago_external_reference' as ref from \\\"order\\\" order by created_at desc limit 1;\""
```

Pegar o `ref` retornado e conferir:

```bash
ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67 "docker exec mercado-preto-db psql -U medusa -d mercado_preto -c \"select \\\"externalReference\\\", \\\"preferenceId\\\" from checkout_snapshot where \\\"externalReference\\\" = '<ref>';\""
```

Expected: existe uma linha em `checkout_snapshot` com o mesmo `externalReference`, `preferenceId` preenchido, e o pedido criado tem itens (`select count(*) from order_item oi join order_line_item oli on oi.item_id = oli.id where oi.order_id = '<order_id>';` deve ser > 0).

Checar também o log do backend (`docker logs mercado-preto-api --since 5m | grep webhook`) — deve aparecer `"metadados recuperados do snapshot local"`, não `"metadados recuperados da preferência"` (esse log só aparece no fallback legado).

- [ ] **Step 4: Registrar o resultado**

Atualizar `docs/qa/2026-08-27-multi-seller-order-split-verification.md` (ou criar um novo doc de QA, se preferir manter o histórico separado) removendo o achado do "pedido fantasma" da lista de bloqueadores, com o resultado desta verificação.
