# Classificação de NCM por Categoria de Produto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed generic NCM (`44199000`) used in every NF-e item with a real NCM resolved from the sold product's category, while keeping product registration unchanged for sellers.

**Architecture:** NCM values live in `product_category.metadata.ncm` (native Medusa field, no new module). At fiscal-emission time, `order-fiscal-emit.ts` (and the admin retry route) resolve each order item's NCM via a new pure function (`resolveNcmForVariant`) that walks `variant → product → categories` through Medusa's remote query (`query.graph`), preferring the most specific category. If no category has a valid NCM, the existing placeholder is used and the `nf_document` record is flagged (`ncmFallbackUsed`) for later review — the sale is never blocked.

**Tech Stack:** Medusa v2 (`@medusajs/framework`), TypeScript, Jest (`pnpm test:unit`), PostgreSQL via MikroORM raw-SQL migrations (existing project convention — no `medusa db:generate`).

**Spec:** `docs/superpowers/specs/2026-08-25-fiscal-ncm-classification-design.md`

## Global Constraints

- NCM values are stored as raw 8-digit strings (no dots), matching what `helpers.ts::buildNfePayload` already sends to Focus NFe (e.g. `"44199000"`, not `"4419.90.00"`).
- A value in `product_category.metadata.ncm` is only used if it matches `/^\d{8}$/` exactly — anything else is treated as absent (falls back), never sent to SEFAZ unvalidated.
- `"Produtos MAB"` is the only generic category name to skip during resolution (per spec). Define this as an exported constant so it's a one-line change later if more generic buckets appear.
- All new/changed subscriber and route code that reads `order.*` must keep the `select` array complete for every field it reads — this codebase already had two rounds of bugs from `select` silently dropping fields (see `order-fiscal-emit.ts` history). Don't reintroduce that class of bug.
- Every task's tests run via: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- <path>`.

---

## Task 1: Add `ncmFallbackUsed` to the `nf_document` model

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/modules/fiscal/models/nf-document.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/fiscal/migrations/Migration20260825150000.ts`

**Interfaces:**
- Produces: `nf_document.ncmFallbackUsed: boolean` (default `false`), readable via `fiscalService.listNfDocuments(...)` / `GET /admin/fiscal`, settable via `createNfDocuments`/`updateNfDocuments`.

- [ ] **Step 1: Add the field to the model**

Edit `packages/medusa-backend/apps/backend/src/modules/fiscal/models/nf-document.ts` — add one line after `amountCents: model.number(),`:

```ts
import { model } from "@medusajs/framework/utils"

const NfDocument = model.define("nf_document", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  sellerId: model.text(),
  type: model.enum(["nfe", "nfse"]).default("nfe"),
  status: model.enum(["pending", "processing", "issued", "cancelled", "error"]).default("pending"),
  focusNfeRef: model.text().nullable(),
  focusNfeId: model.text().nullable(),
  xmlUrl: model.text().nullable(),
  pdfUrl: model.text().nullable(),
  series: model.text().nullable(),
  number: model.text().nullable(),
  issuedAt: model.dateTime().nullable(),
  errorMessage: model.text().nullable(),
  amountCents: model.number(),
  ncmFallbackUsed: model.boolean().default(false),
})

export default NfDocument
```

- [ ] **Step 2: Write the migration**

Create `packages/medusa-backend/apps/backend/src/modules/fiscal/migrations/Migration20260825150000.ts` — mirrors the existing `alter table add column` migration in `src/modules/seller/migrations/Migration20260517035455.ts`:

```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "nf_document" add column if not exists "ncmFallbackUsed" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "nf_document" drop column if exists "ncmFallbackUsed";`);
  }

}
```

- [ ] **Step 3: Run the migration locally**

Run: `cd packages/medusa-backend/apps/backend && npx medusa db:migrate 2>&1 | tail -20`
Expected: no errors, output mentions running `Migration20260825150000`.

- [ ] **Step 4: Verify the column exists**

Run: `psql "$DATABASE_URL" -c "\d nf_document" | grep ncmFallbackUsed` (or the local equivalent for however this project's dev DB is reached)
Expected: a row showing `ncmFallbackUsed | boolean | not null | default false` (or equivalent).

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/fiscal/models/nf-document.ts packages/medusa-backend/apps/backend/src/modules/fiscal/migrations/Migration20260825150000.ts
git commit -m "feat(fiscal): adicionar campo ncmFallbackUsed ao nf_document"
```

---

## Task 2: `resolveNcmForVariant` — category NCM resolution

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/modules/fiscal/ncm-resolver.ts`
- Test: `packages/medusa-backend/apps/backend/src/modules/fiscal/__tests__/ncm-resolver.unit.spec.ts`

**Interfaces:**
- Produces: `resolveNcmForVariant(query: RemoteQueryLike, variantId: string): Promise<string | undefined>` and `GENERIC_CATEGORY_NAMES: string[]`, both exported from `ncm-resolver.ts`. `RemoteQueryLike` is `{ graph: (args: any) => Promise<{ data: any[] }> }` — the same shape `container.resolve(ContainerRegistrationKeys.QUERY)` returns, matching the pattern already used in `src/scripts/reindex-search.ts` and `src/api/seller/products/[id]/route.ts`.
- Consumes: nothing from other tasks in this plan (self-contained, testable in isolation with a mocked `query`).

- [ ] **Step 1: Write the failing tests**

Create `packages/medusa-backend/apps/backend/src/modules/fiscal/__tests__/ncm-resolver.unit.spec.ts`:

```ts
import { resolveNcmForVariant, GENERIC_CATEGORY_NAMES } from "../ncm-resolver"

function makeQuery(categories: Array<{ name: string; metadata?: Record<string, unknown> }>) {
  return {
    graph: jest.fn().mockResolvedValue({
      data: [{ product: { categories } }],
    }),
  }
}

describe("resolveNcmForVariant", () => {
  it("returns the NCM from the only category when it has a valid one", async () => {
    const query = makeQuery([{ name: "BOLSAS", metadata: { ncm: "42029200" } }])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("42029200")
  })

  it("prefers a specific category over a generic one, regardless of order", async () => {
    const query = makeQuery([
      { name: "Produtos MAB", metadata: { ncm: "99999999" } },
      { name: "BOLSAS", metadata: { ncm: "42029200" } },
    ])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("42029200")
  })

  it("picks the alphabetically-first specific category when more than one has a valid NCM", async () => {
    const query = makeQuery([
      { name: "COLARES", metadata: { ncm: "71179000" } },
      { name: "BOLSAS", metadata: { ncm: "42029200" } },
    ])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("42029200")
  })

  it("skips a specific category with no metadata.ncm and uses the next one", async () => {
    const query = makeQuery([
      { name: "BOLSAS", metadata: {} },
      { name: "COLARES", metadata: { ncm: "71179000" } },
    ])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("71179000")
  })

  it("treats a malformed NCM (not 8 digits) as absent", async () => {
    const query = makeQuery([{ name: "BOLSAS", metadata: { ncm: "4202.92.00" } }])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("returns undefined when only the generic category is present", async () => {
    const query = makeQuery([{ name: "Produtos MAB", metadata: { ncm: "99999999" } }])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("returns undefined when the product has no categories", async () => {
    const query = makeQuery([])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("returns undefined instead of throwing when the query fails", async () => {
    const query = { graph: jest.fn().mockRejectedValue(new Error("db unavailable")) }
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("queries product_variant filtered by the given id, requesting category name and metadata", async () => {
    const query = makeQuery([{ name: "BOLSAS", metadata: { ncm: "42029200" } }])
    await resolveNcmForVariant(query as any, "variant-42")
    expect(query.graph).toHaveBeenCalledWith({
      entity: "product_variant",
      fields: ["product.categories.name", "product.categories.metadata"],
      filters: { id: "variant-42" },
    })
  })

  it("exposes GENERIC_CATEGORY_NAMES containing 'Produtos MAB'", () => {
    expect(GENERIC_CATEGORY_NAMES).toContain("Produtos MAB")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- ncm-resolver 2>&1 | tail -30`
Expected: FAIL — `Cannot find module '../ncm-resolver'`.

- [ ] **Step 3: Implement**

Create `packages/medusa-backend/apps/backend/src/modules/fiscal/ncm-resolver.ts`:

```ts
export const GENERIC_CATEGORY_NAMES = ["Produtos MAB"]

interface RemoteQueryLike {
  graph: (args: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: any[] }>
}

function isValidNcm(value: unknown): value is string {
  return typeof value === "string" && /^\d{8}$/.test(value)
}

/**
 * Resolves the NCM (fiscal product-type code) for a sold variant by walking
 * variant -> product -> categories. The most specific category wins: generic
 * catch-all buckets (GENERIC_CATEGORY_NAMES) are ignored unless they're the
 * only category present, and ties between specific categories are broken
 * alphabetically by name (query.graph doesn't guarantee return order).
 *
 * Never throws — any failure (missing variant, query error, no NCM anywhere)
 * resolves to undefined, so callers can fall back to a safe default instead
 * of blocking fiscal emission.
 */
export async function resolveNcmForVariant(
  query: RemoteQueryLike,
  variantId: string
): Promise<string | undefined> {
  try {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["product.categories.name", "product.categories.metadata"],
      filters: { id: variantId },
    })

    const categories: Array<{ name: string; metadata?: Record<string, unknown> }> =
      data?.[0]?.product?.categories ?? []

    const specific = categories
      .filter((category) => !GENERIC_CATEGORY_NAMES.includes(category.name))
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const category of specific) {
      const ncm = category.metadata?.ncm
      if (isValidNcm(ncm)) return ncm
    }

    return undefined
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- ncm-resolver 2>&1 | tail -30`
Expected: PASS, 11/11.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/fiscal/ncm-resolver.ts packages/medusa-backend/apps/backend/src/modules/fiscal/__tests__/ncm-resolver.unit.spec.ts
git commit -m "feat(fiscal): resolver de NCM por categoria de produto"
```

---

## Task 3: Wire `ncmFallbackUsed` through `FiscalModuleService`

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/modules/fiscal/helpers.ts`
- Modify: `packages/medusa-backend/apps/backend/src/modules/fiscal/service.ts`
- Test: `packages/medusa-backend/apps/backend/src/modules/fiscal/__tests__/service.unit.spec.ts`

**Interfaces:**
- Consumes: nothing new from Task 1/2 directly (this task doesn't call `resolveNcmForVariant` — callers of `emitNfe`/`retryNfe` do that and just pass the resulting boolean in).
- Produces: `EmitNfeInput.ncmFallbackUsed?: boolean` — Task 4 and Task 5 set this field when building the input they pass to `emitNfe`/`retryNfe`.

- [ ] **Step 1: Add the field to `EmitNfeInput`**

Edit `packages/medusa-backend/apps/backend/src/modules/fiscal/helpers.ts` — add one line to the `EmitNfeInput` interface (near the top of the file):

```ts
export interface EmitNfeInput {
  orderId: string
  sellerId: string
  amountCents: number
  buyerName: string
  buyerDocument: string
  buyerEmail: string
  buyerAddress: {
    street: string
    number: string
    district: string
    city: string
    state: string
    zipCode: string
  }
  items: Array<{
    description: string
    quantity: number
    unitPrice: number
    ncm?: string
  }>
  ncmFallbackUsed?: boolean
}
```

- [ ] **Step 2: Write the failing test**

Add to `packages/medusa-backend/apps/backend/src/modules/fiscal/__tests__/service.unit.spec.ts`, inside the existing `describe("FiscalModuleService.emitNfe", ...)` block (after the `"creates document then sets error when FOCUS_NFE_TOKEN is not configured"` test):

```ts
  it("passes ncmFallbackUsed through to the created document (defaults to false when absent)", async () => {
    const svc = makeService()
    await svc.emitNfe(baseInput)
    expect(svc.createNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ ncmFallbackUsed: false })
    )
  })

  it("records ncmFallbackUsed: true when the caller flags a fallback", async () => {
    const svc = makeService()
    await svc.emitNfe({ ...baseInput, ncmFallbackUsed: true })
    expect(svc.createNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ ncmFallbackUsed: true })
    )
  })
```

Also add, inside the existing `describe("FiscalModuleService.retryNfe", ...)` block:

```ts
  it("re-records ncmFallbackUsed on the processing update when retrying", async () => {
    const svc = makeService()
    await svc.retryNfe("doc-1", { ...baseInput, ncmFallbackUsed: true })
    expect(svc.updateNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", status: "processing", ncmFallbackUsed: true })
    )
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- fiscal/__tests__/service 2>&1 | tail -40`
Expected: FAIL — the 3 new assertions don't match (`ncmFallbackUsed` missing from the actual call).

- [ ] **Step 4: Implement**

In `packages/medusa-backend/apps/backend/src/modules/fiscal/service.ts`, edit `emitNfe`:

```ts
  async emitNfe(
    input: import("./helpers").EmitNfeInput
  ): Promise<any> {
    if (input.amountCents <= 0) {
      throw new Error("Valor do pedido deve ser maior que zero")
    }

    const ref = `order-${input.orderId}`

    const doc = await this.createNfDocuments({
      orderId: input.orderId,
      sellerId: input.sellerId,
      type: "nfe",
      status: "processing",
      focusNfeRef: ref,
      amountCents: input.amountCents,
      ncmFallbackUsed: input.ncmFallbackUsed ?? false,
    } as any) as any

    return this.sendToFocus(doc.id, ref, input)
  }
```

And `retryNfe`:

```ts
  async retryNfe(
    id: string,
    input: import("./helpers").EmitNfeInput
  ): Promise<any> {
    if (input.amountCents <= 0) {
      throw new Error("Valor do pedido deve ser maior que zero")
    }

    const [doc] = await this.listNfDocuments({ id } as any)
    if (!doc) throw new Error("Documento não encontrado")
    if (doc.status !== "error") {
      throw new Error("Apenas documentos com erro podem ser reprocessados")
    }

    await this.updateNfDocuments({
      id,
      status: "processing",
      errorMessage: null,
      ncmFallbackUsed: input.ncmFallbackUsed ?? false,
    })

    const ref = (doc as any).focusNfeRef || `order-${input.orderId}`
    return this.sendToFocus(id, ref, input)
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- fiscal/__tests__/service 2>&1 | tail -40`
Expected: PASS, all tests (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/fiscal/helpers.ts packages/medusa-backend/apps/backend/src/modules/fiscal/service.ts packages/medusa-backend/apps/backend/src/modules/fiscal/__tests__/service.unit.spec.ts
git commit -m "feat(fiscal): propagar ncmFallbackUsed em emitNfe/retryNfe"
```

---

## Task 4: Resolve real NCM per item in `order-fiscal-emit.ts`

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/order-fiscal-emit.ts`
- Test: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-fiscal-emit.unit.spec.ts`

**Interfaces:**
- Consumes: `resolveNcmForVariant(query, variantId)` from Task 2 (`../modules/fiscal/ncm-resolver`); `EmitNfeInput.ncmFallbackUsed` from Task 3.
- Produces: nothing new consumed elsewhere — this is a leaf subscriber.

- [ ] **Step 1: Update the existing tests for the new container dependency and NCM resolution**

The current `order-fiscal-emit.unit.spec.ts` container mock only provides `Modules.ORDER` and `fiscal`. Once this task adds a `query.graph` call, every existing test needs a mocked `query` too, or the subscriber must tolerate a missing one gracefully — this codebase's established call pattern in tests is to make `makeContainer` throw on unlisted keys, so every test must provide it explicitly.

Replace the full contents of `packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-fiscal-emit.unit.spec.ts`:

```ts
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import orderFiscalEmit from "../order-fiscal-emit"

function makeContainer(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeQuery(ncmByVariant: Record<string, string | undefined>) {
  return {
    graph: jest.fn().mockImplementation(async ({ filters }: any) => {
      const ncm = ncmByVariant[filters.id]
      return {
        data: [{ product: { categories: ncm ? [{ name: "BOLSAS", metadata: { ncm } }] : [] } }],
      }
    }),
  }
}

const baseOrder = {
  id: "order_1",
  email: "buyer@test.com",
  total: 16500,
  metadata: { seller_id: "seller_1", buyer_document: "12345678909" },
  shipping_address: {
    first_name: "Maria",
    last_name: "Testadora",
    address_1: "Av. Paulista",
    address_2: "1000",
    city: "São Paulo",
    province: "SP",
    postal_code: "01310100",
  },
  items: [{ title: "Bolsa Africana 2 em 1", quantity: 1, unit_price: 15000, variant_id: "variant-1" }],
}

describe("orderFiscalEmit", () => {
  it("requests total/metadata/email in select — select is a whitelist, so any field read from order.* must be listed or comes back undefined", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const emitNfe = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      fiscal: { emitNfe },
      [ContainerRegistrationKeys.QUERY]: makeQuery({ "variant-1": "42029200" }),
    })

    await orderFiscalEmit({ event: { data: { id: "order_1" } }, container } as any)

    expect(retrieveOrder).toHaveBeenCalledWith(
      "order_1",
      expect.objectContaining({
        select: expect.arrayContaining(["total", "metadata", "email"]),
      })
    )
  })

  it("passes the real seller_id and amountCents from order.metadata/order.total to emitNfe", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const emitNfe = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      fiscal: { emitNfe },
      [ContainerRegistrationKeys.QUERY]: makeQuery({ "variant-1": "42029200" }),
    })

    await orderFiscalEmit({ event: { data: { id: "order_1" } }, container } as any)

    expect(emitNfe).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerId: "seller_1",
        amountCents: 16500,
        buyerDocument: "12345678909",
        buyerEmail: "buyer@test.com",
      })
    )
  })

  it("does nothing when the order is not found", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(null)
    const emitNfe = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      fiscal: { emitNfe },
      [ContainerRegistrationKeys.QUERY]: makeQuery({}),
    })

    await orderFiscalEmit({ event: { data: { id: "order_1" } }, container } as any)

    expect(emitNfe).not.toHaveBeenCalled()
  })

  it("resolves each item's NCM from its variant's category and sets ncmFallbackUsed: false when all items resolve", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const emitNfe = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      fiscal: { emitNfe },
      [ContainerRegistrationKeys.QUERY]: makeQuery({ "variant-1": "42029200" }),
    })

    await orderFiscalEmit({ event: { data: { id: "order_1" } }, container } as any)

    expect(emitNfe).toHaveBeenCalledWith(
      expect.objectContaining({
        ncmFallbackUsed: false,
        items: [expect.objectContaining({ ncm: "42029200" })],
      })
    )
  })

  it("sets ncmFallbackUsed: true when a variant's category has no NCM configured", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const emitNfe = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      fiscal: { emitNfe },
      [ContainerRegistrationKeys.QUERY]: makeQuery({ "variant-1": undefined }),
    })

    await orderFiscalEmit({ event: { data: { id: "order_1" } }, container } as any)

    expect(emitNfe).toHaveBeenCalledWith(
      expect.objectContaining({
        ncmFallbackUsed: true,
        items: [expect.objectContaining({ ncm: undefined })],
      })
    )
  })

  it("sets ncmFallbackUsed: true when an item has no variant_id at all", async () => {
    const orderWithoutVariant = {
      ...baseOrder,
      items: [{ title: "Item avulso", quantity: 1, unit_price: 1000 }],
    }
    const retrieveOrder = jest.fn().mockResolvedValue(orderWithoutVariant)
    const emitNfe = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      fiscal: { emitNfe },
      [ContainerRegistrationKeys.QUERY]: makeQuery({}),
    })

    await orderFiscalEmit({ event: { data: { id: "order_1" } }, container } as any)

    expect(emitNfe).toHaveBeenCalledWith(expect.objectContaining({ ncmFallbackUsed: true }))
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- order-fiscal-emit 2>&1 | tail -50`
Expected: FAIL — the 3 new NCM-related tests fail (`ncm`/`ncmFallbackUsed` not set), and the "does nothing when the order is not found" test fails with "Unexpected resolve: query" (the subscriber doesn't resolve `query` yet, but the container mock doesn't require it to for that test to pass — this confirms baseline).

- [ ] **Step 3: Implement**

Replace `packages/medusa-backend/apps/backend/src/subscribers/order-fiscal-emit.ts`:

```ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FISCAL_MODULE } from "../modules/fiscal"
import FiscalModuleService from "../modules/fiscal/service"
import { resolveNcmForVariant } from "../modules/fiscal/ncm-resolver"
import { SELLER_MODULE } from "../modules/seller"

export default async function orderFiscalEmit({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  const fiscalService: FiscalModuleService = container.resolve(FISCAL_MODULE)

  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(orderId, {
    relations: ["items", "shipping_address"],
    // "total" must be in select or Medusa never computes order totals
    // (order.total stays undefined, see order-summary decoration logic
    // in @medusajs/order's shouldIncludeTotals). Passing `select` makes it
    // an explicit whitelist, so metadata/email must be listed too or they
    // silently come back undefined even though the columns exist.
    select: ["total", "metadata", "email"],
  })

  if (!order) return

  const sellerId: string | undefined = (order.metadata as any)?.seller_id
  const amountCents = Number(order.total ?? 0)

  const address = (order as any).shipping_address

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const rawItems = (order as any).items ?? []
  let ncmFallbackUsed = false

  const items = await Promise.all(
    rawItems.map(async (item: any) => {
      const ncm = item.variant_id
        ? await resolveNcmForVariant(query, item.variant_id)
        : undefined
      if (!ncm) ncmFallbackUsed = true
      return {
        description: item.title,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price ?? 0),
        ncm,
      }
    })
  )

  await fiscalService.emitNfe({
    orderId,
    sellerId: sellerId ?? "unknown",
    amountCents,
    buyerName: address?.first_name
      ? `${address.first_name} ${address.last_name || ""}`.trim()
      : "Consumidor Final",
    buyerDocument: (order.metadata as any)?.buyer_document || "000.000.000-00",
    buyerEmail: (order as any).email || "",
    buyerAddress: {
      street: address?.address_1 || "Não informado",
      number: address?.address_2 || "S/N",
      district: (address?.metadata as any)?.district || "Centro",
      city: address?.city || "Cachoeira",
      state: address?.province || "BA",
      zipCode: address?.postal_code || "44300000",
    },
    items,
    ncmFallbackUsed,
  })
}

export const config: SubscriberConfig = {
  event: "mercadopago.order_approved",
}
```

(`SELLER_MODULE` was already imported in the original file though unused there too — kept as-is, not in scope of this change to remove it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- order-fiscal-emit 2>&1 | tail -50`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/subscribers/order-fiscal-emit.ts packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-fiscal-emit.unit.spec.ts
git commit -m "feat(fiscal): resolver NCM real por item ao emitir NF-e de pedido"
```

---

## Task 5: Same NCM resolution in the admin retry route (+ fix its pre-existing `select` bug)

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/fiscal/[id]/retry/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/admin/fiscal/[id]/retry/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `resolveNcmForVariant` from Task 2, same as Task 4.

**Context found during planning:** this route already had the exact same `select`-whitelist bug fixed in `order-fiscal-emit.ts` during the previous session (PR #34) — it calls `orderService.retrieveOrder(..., { relations: [...] })` without `select`, then reads `order.metadata` and `order.email`, both of which come back `undefined`. It was missed then because this route has no test file. Fixed here since this task is already rewriting the surrounding code.

- [ ] **Step 1: Write the failing tests**

Create `packages/medusa-backend/apps/backend/src/api/admin/fiscal/[id]/retry/__tests__/route.unit.spec.ts`:

```ts
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeQuery(ncmByVariant: Record<string, string | undefined>) {
  return {
    graph: jest.fn().mockImplementation(async ({ filters }: any) => {
      const ncm = ncmByVariant[filters.id]
      return {
        data: [{ product: { categories: ncm ? [{ name: "BOLSAS", metadata: { ncm } }] : [] } }],
      }
    }),
  }
}

function makeReqRes(overrides: {
  doc?: any
  order?: any
  retryNfe?: jest.Mock
  ncmByVariant?: Record<string, string | undefined>
}) {
  const listNfDocuments = jest.fn().mockResolvedValue(overrides.doc ? [overrides.doc] : [])
  const retryNfe = overrides.retryNfe ?? jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
  const retrieveOrder = jest.fn().mockResolvedValue(overrides.order)

  const req = {
    params: { id: "doc-1" },
    scope: {
      resolve: (key: string) => {
        if (key === "fiscal") return { listNfDocuments, retryNfe }
        if (key === Modules.ORDER) return { retrieveOrder }
        if (key === ContainerRegistrationKeys.QUERY) return makeQuery(overrides.ncmByVariant ?? {})
        throw new Error(`Unexpected resolve: ${key}`)
      },
    },
  } as any

  const res = {
    _status: 200,
    _body: undefined as any,
    status(code: number) { this._status = code; return this },
    json(body: any) { this._body = body; return this },
  } as any

  return { req, res, listNfDocuments, retryNfe, retrieveOrder }
}

const baseDoc = { id: "doc-1", orderId: "order-1", amountCents: 5000 }
const baseOrder = {
  metadata: { buyer_document: "12345678909" },
  email: "buyer@test.com",
  shipping_address: {
    first_name: "Maria",
    last_name: "Testadora",
    address_1: "Rua Teste",
    address_2: "100",
    city: "Salvador",
    province: "BA",
    postal_code: "40000000",
  },
  items: [{ title: "Produto", quantity: 1, unit_price: 5000, variant_id: "variant-1" }],
}

describe("POST /admin/fiscal/:id/retry", () => {
  it("returns 404 when the document doesn't exist", async () => {
    const { req, res } = makeReqRes({})
    await POST(req, res)
    expect(res._status).toBe(404)
  })

  it("requests metadata/email in select so buyer_document/email aren't silently dropped", async () => {
    const { req, res, retrieveOrder } = makeReqRes({ doc: baseDoc, order: baseOrder })
    await POST(req, res)
    expect(retrieveOrder).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({ select: expect.arrayContaining(["metadata", "email"]) })
    )
  })

  it("passes the real buyer_document and buyerEmail from the order to retryNfe", async () => {
    const retryNfe = jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
    const { req, res } = makeReqRes({ doc: baseDoc, order: baseOrder, retryNfe })
    await POST(req, res)
    expect(retryNfe).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({ buyerDocument: "12345678909", buyerEmail: "buyer@test.com" })
    )
  })

  it("resolves NCM per item and sets ncmFallbackUsed: false when it resolves", async () => {
    const retryNfe = jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
    const { req, res } = makeReqRes({
      doc: baseDoc,
      order: baseOrder,
      retryNfe,
      ncmByVariant: { "variant-1": "42029200" },
    })
    await POST(req, res)
    expect(retryNfe).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        ncmFallbackUsed: false,
        items: [expect.objectContaining({ ncm: "42029200" })],
      })
    )
  })

  it("sets ncmFallbackUsed: true when no category NCM is found", async () => {
    const retryNfe = jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
    const { req, res } = makeReqRes({
      doc: baseDoc,
      order: baseOrder,
      retryNfe,
      ncmByVariant: { "variant-1": undefined },
    })
    await POST(req, res)
    expect(retryNfe).toHaveBeenCalledWith("doc-1", expect.objectContaining({ ncmFallbackUsed: true }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- admin/fiscal 2>&1 | tail -50`
Expected: FAIL — `select` isn't requested, `ncm`/`ncmFallbackUsed` aren't set.

- [ ] **Step 3: Implement**

Replace `packages/medusa-backend/apps/backend/src/api/admin/fiscal/[id]/retry/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FISCAL_MODULE } from "../../../../../modules/fiscal"
import FiscalModuleService from "../../../../../modules/fiscal/service"
import { resolveNcmForVariant } from "../../../../../modules/fiscal/ncm-resolver"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const fiscalService: FiscalModuleService = req.scope.resolve(FISCAL_MODULE)
  const orderService = req.scope.resolve(Modules.ORDER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id } = req.params

  try {
    const [doc] = await fiscalService.listNfDocuments({ id } as any)
    if (!doc) return res.status(404).json({ error: "Documento não encontrado" })

    const order = await orderService.retrieveOrder((doc as any).orderId, {
      relations: ["items", "shipping_address"],
      // Same select-whitelist gotcha as order-fiscal-emit.ts: metadata/email
      // silently come back undefined without this.
      select: ["metadata", "email"],
    })

    const address = (order as any).shipping_address

    const rawItems = (order as any).items ?? []
    let ncmFallbackUsed = false
    const items = await Promise.all(
      rawItems.map(async (item: any) => {
        const ncm = item.variant_id
          ? await resolveNcmForVariant(query, item.variant_id)
          : undefined
        if (!ncm) ncmFallbackUsed = true
        return {
          description: item.title,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price ?? 0),
          ncm,
        }
      })
    )

    const input = {
      orderId: (doc as any).orderId,
      sellerId: (doc as any).sellerId,
      amountCents: (doc as any).amountCents,
      buyerName: address?.first_name
        ? `${address.first_name} ${address.last_name || ""}`.trim()
        : "Consumidor Final",
      buyerDocument: (order.metadata as any)?.buyer_document || "",
      buyerEmail: (order as any).email || "",
      buyerAddress: {
        street: address?.address_1 || "Não informado",
        number: address?.address_2 || "S/N",
        district: (address?.metadata as any)?.district || "Centro",
        city: address?.city || "Cachoeira",
        state: address?.province || "BA",
        zipCode: address?.postal_code || "44300000",
      },
      items,
      ncmFallbackUsed,
    }

    const updatedDoc = await fiscalService.retryNfe(id, input)
    res.json({ document: updatedDoc })
  } catch (err: any) {
    res.status(400).json({ error: err?.message })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- admin/fiscal 2>&1 | tail -50`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add "packages/medusa-backend/apps/backend/src/api/admin/fiscal/[id]/retry/route.ts" "packages/medusa-backend/apps/backend/src/api/admin/fiscal/[id]/retry/__tests__/route.unit.spec.ts"
git commit -m "fix(fiscal): resolver NCM real no retry admin e corrigir select incompleto"
```

---

## Task 6: Seed the initial category → NCM mapping

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/scripts/set-category-ncm.ts`

**Interfaces:**
- Consumes: nothing from other tasks (standalone `medusa exec` script, same shape as the existing `src/scripts/reindex-search.ts`).
- Produces: `product_category.metadata.ncm` populated for the categories listed in the spec's table (the ones with a proposed code — categories marked "sem proposta" in the spec are intentionally left unset).

No unit test for this one — it's a one-off/re-runnable data script, matching the existing convention (`reindex-search.ts`, `import-mab-catalog.ts` have no test files either). Verified by running it and inspecting the result (Step 2 below).

- [ ] **Step 1: Write the script**

Create `packages/medusa-backend/apps/backend/src/scripts/set-category-ncm.ts`:

```ts
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Initial category -> NCM mapping proposed in
 * docs/superpowers/specs/2026-08-25-fiscal-ncm-classification-design.md.
 * Raw 8-digit codes (no dots), matching what buildNfePayload sends to
 * Focus NFe. Categories not listed here are intentionally left unset —
 * see the spec's "sem proposta" rows — and fall back to the generic
 * placeholder with ncmFallbackUsed: true until a human sets a real value.
 *
 * Re-run this script any time the mapping changes:
 *   npx medusa exec ./src/scripts/set-category-ncm.ts
 */
const CATEGORY_NCM: Record<string, string> = {
  "BOLSAS": "42029200",
  "SACOLÕES": "42029200",
  "COLARES": "71179000",
  "BRINCOS": "71179000",
  "BRINCO AFRICANO": "71179000",
  "PULSEIRAS": "71179000",
  "PINGENTE": "71179000",
  "CANECAS, COPOS E GARRAFAS": "69120000",
  "CHAPÉUS": "65040000",
  "LUMINÁRIAS": "94055000",
  "KIT LUMINÁRIA": "94055000",
  "KITS PARA COZINHA": "69120000",
  "PETISQUEIRAS": "69120000",
}

export default async function setCategoryNcm({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productModuleService = container.resolve(Modules.PRODUCT)

  for (const [name, ncm] of Object.entries(CATEGORY_NCM)) {
    const categories = await productModuleService.listProductCategories({ name })

    if (categories.length === 0) {
      logger.warn(`[set-category-ncm] categoria "${name}" não encontrada — pulando`)
      continue
    }

    for (const category of categories) {
      await productModuleService.updateProductCategories(category.id, {
        metadata: { ...(category.metadata ?? {}), ncm },
      })
      logger.info(`[set-category-ncm] "${name}" (${category.id}) -> NCM ${ncm}`)
    }
  }

  logger.info("[set-category-ncm] concluído")
}
```

- [ ] **Step 2: Run it against the local/dev database and verify**

Run: `cd packages/medusa-backend/apps/backend && npx medusa exec ./src/scripts/set-category-ncm.ts 2>&1 | tail -40`
Expected: one `[set-category-ncm] "<name>" (<id>) -> NCM <code>` line per category in the map (13 lines), no warnings about categories not found (if any category name doesn't match exactly, e.g. accent/casing mismatch, this is where it'll surface — fix the key in `CATEGORY_NCM` to match the real `product_category.name` value and re-run; the script is idempotent, safe to re-run).

Then spot-check one category directly:

Run: `psql "$DATABASE_URL" -c "select name, metadata from product_category where name = 'BOLSAS';"`
Expected: `metadata` column contains `{"ncm": "42029200"}` (or that key merged with any pre-existing metadata).

- [ ] **Step 3: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/scripts/set-category-ncm.ts
git commit -m "feat(fiscal): script de classificação inicial de NCM por categoria"
```

---

## Task 7: Full verification — real order flow, both with and without a mapped category

**Files:** none (verification only — no new files).

This mirrors the manual verification already done for PR #34: a disposable `medusa exec` script against the deployed test server, not just unit tests, because the thing that matters (Focus NFe accepting the resolved NCM, `nf_document.ncmFallbackUsed` reflecting reality) can only be confirmed against the real database and a real category. **Do this on the OCI test server (`ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67`)**, after deploying this branch there (rebuild + `--force-recreate medusa`, same recipe as PR #34 — see `HANDOFF.md`'s "Deploy recipe used this session" note) and after Task 6's seed script has been run against that server's database.

- [ ] **Step 1: Run the full unit test suite one more time**

Run: `cd packages/medusa-backend/apps/backend && npx pnpm run test:unit -- fiscal subscribers admin/fiscal 2>&1 | tail -60`
Expected: all suites PASS (existing + all new tests from Tasks 1-5).

- [ ] **Step 2: Confirm a mapped category resolves — pick a real variant known to be in "BOLSAS"**

On the server, find a real product/variant in the BOLSAS category (e.g. reuse `variant_01KX7D9TR61PKNSSX0JMNF9V27`, "Bolsa Africana 2 em 1" — confirm it's actually tagged BOLSAS first: `select pc.name from product_category pc join product_category_product pcp on pcp.product_category_id = pc.id join product_variant pv on pv.product_id = pcp.product_id where pv.id = 'variant_01KX7D9TR61PKNSSX0JMNF9V27';`).

Write a disposable script (same pattern as the one used for PR #34's verification — see HANDOFF.md's "Test-order recipe" note) that creates a real order with that variant_id, `metadata.seller_id` and `metadata.buyer_document` set, emits `mercadopago.order_approved`, and waits a few seconds before exiting. Run it via `docker cp` + `docker exec mercado-preto-api npx medusa exec ...`.

Expected in `nf_document` for that order: `status: 'issued'`, `ncmFallbackUsed: false`. Cross-check the actual XML/DANFE via `caminho_xml_nota_fiscal`/`caminho_danfe` if you want to confirm `42029200` is really what SEFAZ received (optional — `status: issued` already proves SEFAZ accepted it).

- [ ] **Step 3: Confirm an unmapped category falls back correctly**

Repeat Step 2 with a variant from a category with no NCM configured (e.g. `DECORAÇÃO`, intentionally left unmapped per the spec).

Expected: `nf_document.status: 'issued'` (sale still succeeds) and `ncmFallbackUsed: true`.

- [ ] **Step 4: Clean up**

Delete any disposable test script from the container (`docker exec mercado-preto-api rm -f /app/src/scripts/<disposable-name>.js`) — don't leave throwaway scripts in the image, matching how PR #34's verification was cleaned up.

- [ ] **Step 5: Update HANDOFF.md**

Add a short entry noting this feature is deployed and verified, including the confirmation from Steps 2-3, and list the categories still without a proposed NCM (per the spec's "sem proposta" rows) as an open item for the user/accountant.

---

## Self-review notes (from plan authoring)

- **Spec coverage:** all 7 numbered decisions in the spec map to a task — (1)/(7) metadata storage + no new UI → Task 6; (2) sellers unaffected → no code change needed, nothing to task; (3) resolution at emission time → Tasks 4/5; (4) specificity + alphabetical tiebreak → Task 2; (5) fallback never blocks → Task 2 (returns `undefined`, never throws) + Tasks 4/5 (still call `emitNfe`/`retryNfe` regardless); (6) `ncmFallbackUsed` on `nf_document`, visible via existing `/admin/fiscal` → Tasks 1/3/4/5 (endpoint itself needs no change — the field is already returned by `listNfDocuments`, and the route already exposes whatever `listNfDocuments` returns).
- **Type consistency checked:** `resolveNcmForVariant(query, variantId)` signature is identical everywhere it's called (Task 4, Task 5). `EmitNfeInput.ncmFallbackUsed?: boolean` (Task 3) matches every call site that sets it (Task 4, Task 5) and every assertion that reads it (Task 3's own tests). `nf_document.ncmFallbackUsed` (Task 1) is the field name used consistently in `service.ts`, both subscriber/route tests, and the verification task.
- **No placeholders:** every step has real, complete code — no "add error handling" or "similar to Task N" shortcuts.
