# Admin Commissions Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Comissões" screen to the Medusa admin dashboard, and fix the underlying dead-code gap where `Commission.status` was never actually updated by any flow.

**Architecture:** A new `payoutId` field links `Commission` records to the `Payout` that settled them. Two existing Payout routes are extended to call new `CommissionModuleService` methods that create and resolve this link. `GET /admin/commissions` is enriched with seller names and a real total count. A new admin route renders the report with filters, totals, and real pagination.

**Tech Stack:** Same as the Vendedores subsystem — Medusa v2 admin extensions (`@medusajs/admin-sdk`, `@medusajs/ui`, `@medusajs/js-sdk`), React 18, TanStack Query v5, Zod, Jest (backend tests), Vitest + `@testing-library/react` (admin frontend tests, already set up).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-11-admin-commissions-management-design.md`
- This screen is **read-only** — no action buttons, no editing a commission.
- Commissions are marked `"paid"` only when the linked `Payout` is processed (`status` → `completed`), never at `Payout` creation time.
- `GET /admin/commissions` must return a real total `count` (not the current page's length) and each commission enriched with `sellerName`.
- Default filters: no status pre-selected ("Todos"), no seller pre-selected ("Todos os vendedores") — this is a report screen, not an action queue.
- Real pagination via `@medusajs/ui`'s `Table.Pagination`, page size 20.
- Any `Select` sentinel value for "all" must be a non-empty string (e.g. `"all"`) — Radix's `Select.Item` throws on an empty-string `value`. This bit the Vendedores plan; do not repeat it.
- Admin frontend test files use `.test.tsx` (never `.unit.spec.ts`/`.unit.spec.tsx`) — picked up by `npm run test:admin` (Vitest), never by the backend's Jest `testMatch`.
- Branch: `feature/admin-commissions-management` (already created, based on `main`, spec already committed as `94230ae`). Do not commit to `main`, `develop`, or any protected branch directly.
- Every task ends with a commit using Conventional Commits format (`type(scope): description`, imperative, lowercase, no trailing period).

---

### Task 1: `payoutId` field + `CommissionModuleService` linking methods

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/modules/commission/models/commission.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/commission/migrations/Migration20260711150000.ts`
- Modify: `packages/medusa-backend/apps/backend/src/modules/commission/service.ts`
- Test: `packages/medusa-backend/apps/backend/src/modules/commission/__tests__/service.unit.spec.ts`

**Interfaces:**
- Produces: `CommissionModuleService.linkPendingToPayout(sellerId: string, periodStart: Date, periodEnd: Date, payoutId: string): Promise<void>` and `CommissionModuleService.markPaidByPayout(payoutId: string): Promise<void>`. Tasks 2 and 3 call these exact methods.
- Produces: `Commission` model gains a `payoutId: string | null` field, used by Task 4's enrichment query indirectly (via the `status`/`paidAt` side effects) and directly filterable via `listCommissions({ payoutId })`.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/modules/commission/__tests__/service.unit.spec.ts`:

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
        listCommissions = jest.fn()
        updateCommissions = jest.fn()
      },
  }
})

import CommissionModuleService from "../service"

function makeService() {
  const svc = new CommissionModuleService() as any
  return svc as CommissionModuleService & {
    listCommissions: jest.Mock
    updateCommissions: jest.Mock
  }
}

describe("CommissionModuleService.linkPendingToPayout", () => {
  it("links only pending commissions within the period to the payout", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([
      { id: "comm_1", sellerId: "seller_1", status: "pending", created_at: "2026-07-05T00:00:00.000Z" },
      { id: "comm_2", sellerId: "seller_1", status: "pending", created_at: "2026-07-20T00:00:00.000Z" },
    ])
    svc.updateCommissions.mockResolvedValue([{}])

    await svc.linkPendingToPayout(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T23:59:59.999Z"),
      "payout_1"
    )

    expect(svc.listCommissions).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending" })
    expect(svc.updateCommissions).toHaveBeenCalledTimes(1)
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_1" },
      data: { payoutId: "payout_1" },
    })
  })

  it("does nothing when there are no pending commissions in the period", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([])

    await svc.linkPendingToPayout(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T00:00:00.000Z"),
      "payout_1"
    )

    expect(svc.updateCommissions).not.toHaveBeenCalled()
  })
})

describe("CommissionModuleService.markPaidByPayout", () => {
  it("marks all commissions linked to the payout as paid", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([
      { id: "comm_1", payoutId: "payout_1" },
      { id: "comm_2", payoutId: "payout_1" },
    ])
    svc.updateCommissions.mockResolvedValue([{}])

    await svc.markPaidByPayout("payout_1")

    expect(svc.listCommissions).toHaveBeenCalledWith({ payoutId: "payout_1" })
    expect(svc.updateCommissions).toHaveBeenCalledTimes(2)
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_1" },
      data: expect.objectContaining({ status: "paid" }),
    })
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_2" },
      data: expect.objectContaining({ status: "paid" }),
    })
  })

  it("does nothing when no commissions are linked to the payout", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([])

    await svc.markPaidByPayout("payout_empty")

    expect(svc.updateCommissions).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/commission/__tests__/service.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL — `svc.linkPendingToPayout is not a function` (the method doesn't exist yet).

- [ ] **Step 3: Add the `payoutId` field to the model**

Modify `packages/medusa-backend/apps/backend/src/modules/commission/models/commission.ts` — current content:

```ts
import { model } from "@medusajs/framework/utils"

const Commission = model.define("commission", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  sellerId: model.text(),
  grossAmount: model.bigNumber(),
  bankingFees: model.bigNumber(),
  netAmount: model.bigNumber(),
  commissionRate: model.number(),
  commissionAmount: model.bigNumber(),
  sellerPayout: model.bigNumber(),
  status: model.enum(["pending", "paid"]).default("pending"),
  paidAt: model.dateTime().nullable(),
})

export default Commission
```

Replace with:

```ts
import { model } from "@medusajs/framework/utils"

const Commission = model.define("commission", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  sellerId: model.text(),
  grossAmount: model.bigNumber(),
  bankingFees: model.bigNumber(),
  netAmount: model.bigNumber(),
  commissionRate: model.number(),
  commissionAmount: model.bigNumber(),
  sellerPayout: model.bigNumber(),
  status: model.enum(["pending", "paid"]).default("pending"),
  paidAt: model.dateTime().nullable(),
  payoutId: model.text().nullable(),
})

export default Commission
```

- [ ] **Step 4: Write the migration**

Create `packages/medusa-backend/apps/backend/src/modules/commission/migrations/Migration20260711150000.ts`:

```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "commission" add column if not exists "payoutId" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "commission" drop column if exists "payoutId";`);
  }

}
```

This matches the exact style of the existing `alter table` migration in `src/modules/seller/migrations/Migration20260517035455.ts`.

- [ ] **Step 5: Add the two service methods**

Modify `packages/medusa-backend/apps/backend/src/modules/commission/service.ts` — add these two methods to the `CommissionModuleService` class, after the existing `markAsPaid` method:

```ts
  async linkPendingToPayout(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date,
    payoutId: string
  ): Promise<void> {
    const pending = await this.listCommissions({ sellerId, status: "pending" })
    const inPeriod = pending.filter((c: any) => {
      const created = new Date(c.created_at)
      return created >= periodStart && created <= periodEnd
    })
    for (const commission of inPeriod) {
      await this.updateCommissions({
        selector: { id: commission.id },
        data: { payoutId },
      })
    }
  }

  async markPaidByPayout(payoutId: string): Promise<void> {
    const linked = await this.listCommissions({ payoutId })
    for (const commission of linked) {
      await this.updateCommissions({
        selector: { id: commission.id },
        data: { status: "paid" as const, paidAt: new Date() },
      })
    }
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/commission/__tests__/service.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — 4/4 tests green.

- [ ] **Step 7: Run the migration locally to confirm it applies cleanly**

Run: `cd packages/medusa-backend/apps/backend && npx medusa db:migrate 2>&1 | tail -20`
Expected: the new migration runs without error (requires a local Postgres reachable via the backend's `.env` — if none is running, note this in your report instead of blocking; the migration's SQL was verified by hand against the existing `alter table` pattern).

- [ ] **Step 8: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/commission
git commit -m "feat(backend): add payoutId to Commission and linking service methods"
```

---

### Task 2: Wire `POST /admin/payouts` to link commissions

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `CommissionModuleService.linkPendingToPayout(sellerId, periodStart, periodEnd, payoutId)` from Task 1 (already merged when this task runs).
- Produces: nothing new for later tasks — this task only adds a side effect to an existing route.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /admin/payouts", () => {
  it("creates the payout and links pending commissions in the period", async () => {
    const createPayouts = jest.fn().mockResolvedValue({ id: "payout_1", sellerId: "seller_1" })
    const linkPendingToPayout = jest.fn().mockResolvedValue(undefined)
    const req = {
      body: {
        sellerId: "seller_1",
        amount: 10000,
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-10T00:00:00.000Z",
      },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(createPayouts).toHaveBeenCalled()
    expect(linkPendingToPayout).toHaveBeenCalledWith(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T00:00:00.000Z"),
      "payout_1"
    )
    expect(res._status).toBe(201)
  })

  it("returns 400 and does not create a payout or link commissions when body is invalid", async () => {
    const createPayouts = jest.fn()
    const linkPendingToPayout = jest.fn()
    const req = {
      body: { sellerId: "seller_1" },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(createPayouts).not.toHaveBeenCalled()
    expect(linkPendingToPayout).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL on the first test — `expect(linkPendingToPayout).toHaveBeenCalledWith(...)` fails with 0 calls received, since the current route never resolves `COMMISSION_MODULE` or calls it.

- [ ] **Step 3: Modify the route**

Current content of `packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { PAYOUT_MODULE } from "../../../modules/payout"
import PayoutModuleService from "../../../modules/payout/service"

const CreatePayoutSchema = z.object({
  sellerId: z.string(),
  amount: z.number().int().positive(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const { seller_id, status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status

  const payouts = await payoutService.listPayouts(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const total = payouts.reduce((acc, p) => acc + Number(p.amount), 0)
  res.json({ payouts, total, count: payouts.length })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)

  const parsed = CreatePayoutSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const payout = await payoutService.createPayouts({
    ...parsed.data,
    periodStart: new Date(parsed.data.periodStart),
    periodEnd: new Date(parsed.data.periodEnd),
  })

  res.status(201).json({ payout })
}
```

Replace the imports at the top (add two lines) and the `POST` function only — leave `GET` and `CreatePayoutSchema` untouched:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { PAYOUT_MODULE } from "../../../modules/payout"
import { COMMISSION_MODULE } from "../../../modules/commission"
import PayoutModuleService from "../../../modules/payout/service"
import CommissionModuleService from "../../../modules/commission/service"
```

```ts
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)

  const parsed = CreatePayoutSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const periodStart = new Date(parsed.data.periodStart)
  const periodEnd = new Date(parsed.data.periodEnd)

  const payout = await payoutService.createPayouts({
    ...parsed.data,
    periodStart,
    periodEnd,
  })

  await commissionService.linkPendingToPayout(parsed.data.sellerId, periodStart, periodEnd, payout.id)

  res.status(201).json({ payout })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__
git commit -m "feat(backend): link pending commissions when a payout is created"
```

---

### Task 3: Wire `POST /admin/payouts/:id/process` to mark commissions paid

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/process/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/process/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `CommissionModuleService.markPaidByPayout(payoutId)` from Task 1.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/process/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /admin/payouts/:id/process", () => {
  it("processes the payout and marks its linked commissions as paid", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "pending" }])
    const markAsProcessed = jest.fn().mockResolvedValue({ id: "payout_1", status: "completed" })
    const markPaidByPayout = jest.fn().mockResolvedValue(undefined)
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, markAsProcessed },
        commission: { markPaidByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(markAsProcessed).toHaveBeenCalledWith("payout_1")
    expect(markPaidByPayout).toHaveBeenCalledWith("payout_1")
    expect(res._status).toBe(200)
  })

  it("returns 404 and does not call markPaidByPayout when payout does not exist", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const markAsProcessed = jest.fn()
    const markPaidByPayout = jest.fn()
    const req = {
      params: { id: "payout_missing" },
      scope: makeScope({
        payout: { listPayouts, markAsProcessed },
        commission: { markPaidByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(markPaidByPayout).not.toHaveBeenCalled()
  })

  it("returns 409 and does not call markPaidByPayout when payout is already completed", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "completed" }])
    const markAsProcessed = jest.fn()
    const markPaidByPayout = jest.fn()
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, markAsProcessed },
        commission: { markPaidByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(409)
    expect(markPaidByPayout).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest "src/api/admin/payouts/\[id\]/process" --silent --runInBand --forceExit`
Expected: FAIL — `markPaidByPayout` was never called (the route doesn't resolve `COMMISSION_MODULE` or call it yet).

- [ ] **Step 3: Modify the route**

Current content of `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/process/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYOUT_MODULE } from "../../../../../modules/payout"
import PayoutModuleService from "../../../../../modules/payout/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const { id } = req.params

  const [existing] = await payoutService.listPayouts({ id })
  if (!existing) return res.status(404).json({ error: "Repasse não encontrado" })
  if (existing.status === "completed") {
    return res.status(409).json({ error: "Repasse já processado" })
  }

  const payout = await payoutService.markAsProcessed(id)
  res.json({ payout })
}
```

Replace entirely with:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYOUT_MODULE } from "../../../../../modules/payout"
import { COMMISSION_MODULE } from "../../../../../modules/commission"
import PayoutModuleService from "../../../../../modules/payout/service"
import CommissionModuleService from "../../../../../modules/commission/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const { id } = req.params

  const [existing] = await payoutService.listPayouts({ id })
  if (!existing) return res.status(404).json({ error: "Repasse não encontrado" })
  if (existing.status === "completed") {
    return res.status(409).json({ error: "Repasse já processado" })
  }

  const payout = await payoutService.markAsProcessed(id)
  await commissionService.markPaidByPayout(id)

  res.json({ payout })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest "src/api/admin/payouts/\[id\]/process" --silent --runInBand --forceExit`
Expected: PASS — 3/3 tests green.

- [ ] **Step 5: Commit**

```bash
git add "packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/process"
git commit -m "feat(backend): mark linked commissions paid when a payout is processed"
```

---

### Task 4: Enrich `GET /admin/commissions` with seller names and real count

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/commissions/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/commissions/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `SellerModuleService.listSellers({ id: string[] })` (existing method, array-filter usage already present elsewhere in the codebase as `listProductCategories({ id: [categoryId] })`).
- Produces: `GET /admin/commissions` response shape `{ commissions: (Commission & { sellerName: string })[], totals: {...}, count: number, limit: number, offset: number }`. Task 5's `useAdminCommissions` hook and Task 6's page consume this exact shape.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/admin/commissions/__tests__/route.unit.spec.ts`:

```ts
import { GET } from "../route"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const baseCommission = {
  id: "comm_1",
  sellerId: "seller_1",
  grossAmount: 10000,
  commissionAmount: 1500,
  sellerPayout: 8500,
}

describe("GET /admin/commissions", () => {
  it("enriches each commission with the seller's name", async () => {
    const listCommissions = jest.fn()
      .mockResolvedValueOnce([baseCommission])
      .mockResolvedValueOnce([baseCommission])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: {},
      scope: makeScope({
        commission: { listCommissions },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listSellers).toHaveBeenCalledWith({ id: ["seller_1"] })
    expect(res._body.commissions[0].sellerName).toBe("Loja Teste")
  })

  it("falls back to a placeholder name when the seller no longer exists", async () => {
    const deletedSellerCommission = { ...baseCommission, sellerId: "seller_deleted" }
    const listCommissions = jest.fn()
      .mockResolvedValueOnce([deletedSellerCommission])
      .mockResolvedValueOnce([deletedSellerCommission])
    const listSellers = jest.fn().mockResolvedValue([])
    const req = {
      query: {},
      scope: makeScope({
        commission: { listCommissions },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.commissions[0].sellerName).toBe("Vendedor removido")
  })

  it("returns the real total count, not just the current page size", async () => {
    const commission2 = { ...baseCommission, id: "comm_2", grossAmount: 5000, commissionAmount: 750, sellerPayout: 4250 }
    const commission3 = { ...baseCommission, id: "comm_3", grossAmount: 5000, commissionAmount: 750, sellerPayout: 4250 }
    const listCommissions = jest.fn()
      .mockResolvedValueOnce([baseCommission])
      .mockResolvedValueOnce([baseCommission, commission2, commission3])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: { limit: "1" },
      scope: makeScope({
        commission: { listCommissions },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.count).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/commissions/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL on the first two tests — `res._body.commissions[0].sellerName` is `undefined` (the current route never resolves `SELLER_MODULE` or attaches a name). The third test (real count) also fails since `res._body.count` is still `1` (page length), not `3`.

- [ ] **Step 3: Modify the route**

Current content of `packages/medusa-backend/apps/backend/src/api/admin/commissions/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMISSION_MODULE } from "../../../modules/commission"
import CommissionModuleService from "../../../modules/commission/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)

  const { seller_id, status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status

  const commissions = await commissionService.listCommissions(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const totals = commissions.reduce(
    (acc, c) => ({
      grossAmount: acc.grossAmount + Number(c.grossAmount),
      commissionAmount: acc.commissionAmount + Number(c.commissionAmount),
      sellerPayout: acc.sellerPayout + Number(c.sellerPayout),
    }),
    { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 }
  )

  res.json({ commissions, totals, count: commissions.length })
}
```

Replace entirely with:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMISSION_MODULE } from "../../../modules/commission"
import { SELLER_MODULE } from "../../../modules/seller"
import CommissionModuleService from "../../../modules/commission/service"
import SellerModuleService from "../../../modules/seller/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const { seller_id, status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status

  const commissions = await commissionService.listCommissions(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const count = await commissionService.listCommissions(filters).then((all) => all.length)

  const sellerIds = [...new Set(commissions.map((c: any) => c.sellerId))]
  const sellers = sellerIds.length > 0 ? await sellerService.listSellers({ id: sellerIds }) : []
  const sellerNameById = new Map(sellers.map((s: any) => [s.id, s.name]))

  const enrichedCommissions = commissions.map((c: any) => ({
    ...c,
    sellerName: sellerNameById.get(c.sellerId) ?? "Vendedor removido",
  }))

  const totals = commissions.reduce(
    (acc, c) => ({
      grossAmount: acc.grossAmount + Number(c.grossAmount),
      commissionAmount: acc.commissionAmount + Number(c.commissionAmount),
      sellerPayout: acc.sellerPayout + Number(c.sellerPayout),
    }),
    { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 }
  )

  res.json({
    commissions: enrichedCommissions,
    totals,
    count,
    limit: Number(limit),
    offset: Number(offset),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/commissions/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — 3/3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/commissions
git commit -m "feat(backend): enrich commissions response with seller name and real count"
```

---

### Task 5: Frontend hooks for commissions

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/hooks/commissions.ts`
- Test: `packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/commissions.test.tsx`

**Interfaces:**
- Consumes: `sdk` from `../lib/sdk` (existing, from Vendedores subsystem).
- Produces (used by Task 6):
  - `type Commission = { id: string; orderId: string; sellerId: string; sellerName: string; grossAmount: number; bankingFees: number; netAmount: number; commissionRate: number; commissionAmount: number; sellerPayout: number; status: "pending" | "paid"; paidAt: string | null; created_at: string }`
  - `useAdminCommissions(filters: { seller_id?: string; status?: string; limit?: number; offset?: number }): UseQueryResult<{ commissions: Commission[]; totals: { grossAmount: number; commissionAmount: number; sellerPayout: number }; count: number; limit: number; offset: number }>`

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/commissions.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { sdk } from "../../lib/sdk"
import { useAdminCommissions } from "../commissions"

vi.mock("../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe("useAdminCommissions", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches /admin/commissions with the given filters", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      commissions: [],
      totals: { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 },
      count: 0,
      limit: 20,
      offset: 0,
    })

    const { result } = renderHook(
      () => useAdminCommissions({ status: "pending", limit: 20, offset: 0 }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", {
      query: { status: "pending", limit: 20, offset: 0 },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../commissions'` (the hooks file doesn't exist yet).

- [ ] **Step 3: Write the hooks file**

Create `packages/medusa-backend/apps/backend/src/admin/hooks/commissions.ts`:

```ts
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

export type Commission = {
  id: string
  orderId: string
  sellerId: string
  sellerName: string
  grossAmount: number
  bankingFees: number
  netAmount: number
  commissionRate: number
  commissionAmount: number
  sellerPayout: number
  status: "pending" | "paid"
  paidAt: string | null
  created_at: string
}

type CommissionsResponse = {
  commissions: Commission[]
  totals: { grossAmount: number; commissionAmount: number; sellerPayout: number }
  count: number
  limit: number
  offset: number
}

export function useAdminCommissions(
  filters: { seller_id?: string; status?: string; limit?: number; offset?: number } = {}
) {
  return useQuery({
    queryKey: ["admin-commissions", filters],
    queryFn: () =>
      sdk.client.fetch<CommissionsResponse>("/admin/commissions", {
        query: filters,
      }),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 1/1 new test green (plus all prior admin tests still passing).

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/admin/hooks/commissions.ts packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/commissions.test.tsx
git commit -m "feat(admin): add useAdminCommissions hook"
```

---

### Task 6: Commissions list page (`/app/commissions`)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/routes/commissions/page.tsx`
- Test: `packages/medusa-backend/apps/backend/src/admin/routes/commissions/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useAdminCommissions`, `type Commission` from `../../hooks/commissions` (Task 5). `useAdminSellers` from `../../hooks/sellers` (existing, Vendedores subsystem) to populate the seller filter dropdown. `defineRouteConfig` from `@medusajs/admin-sdk`.
- Produces: default export `CommissionsPage`, registered at the file-system route `commissions` → `/app/commissions`, sidebar label "Comissões".

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/admin/routes/commissions/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../lib/sdk"
import CommissionsPage from "../page"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const emptySellers = { sellers: [], count: 0 }
const emptyCommissions = {
  commissions: [],
  totals: { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 },
  count: 0,
  limit: 20,
  offset: 0,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommissionsPage />
    </QueryClientProvider>
  )
}

describe("CommissionsPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches commissions with pagination but no status/seller filter by default", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyCommissions)
    })

    renderPage()

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", {
        query: { limit: 20, offset: 0 },
      })
    )
  })

  it("shows the totals cards with formatted BRL values", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve({
        ...emptyCommissions,
        totals: { grossAmount: 100000, commissionAmount: 15000, sellerPayout: 85000 },
      })
    })

    renderPage()

    expect(await screen.findByText("R$ 1.000,00")).toBeInTheDocument()
    expect(screen.getByText("R$ 150,00")).toBeInTheDocument()
    expect(screen.getByText("R$ 850,00")).toBeInTheDocument()
  })

  it("shows an error message when the fetch fails", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.reject(new Error("network error"))
    })

    renderPage()

    expect(
      await screen.findByText("Não foi possível carregar as comissões. Tente novamente.")
    ).toBeInTheDocument()
  })

  it("shows the empty state when there are no commissions", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyCommissions)
    })

    renderPage()

    expect(await screen.findByText("Nenhuma comissão encontrada.")).toBeInTheDocument()
  })

  it("renders a row per commission with seller name, amounts, and status", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve({
        commissions: [
          {
            id: "comm_1",
            orderId: "order_1",
            sellerId: "seller_1",
            sellerName: "Mulheres de Axé do Brasil",
            grossAmount: 10000,
            bankingFees: 300,
            netAmount: 9700,
            commissionRate: 15,
            commissionAmount: 1455,
            sellerPayout: 8245,
            status: "pending",
            paidAt: null,
            created_at: "2026-07-01T00:00:00.000Z",
          },
        ],
        totals: { grossAmount: 10000, commissionAmount: 1455, sellerPayout: 8245 },
        count: 1,
        limit: 20,
        offset: 0,
      })
    })

    renderPage()

    expect(await screen.findByText("order_1")).toBeInTheDocument()
    expect(screen.getByText("Mulheres de Axé do Brasil")).toBeInTheDocument()
    expect(screen.getByText("Pendente")).toBeInTheDocument()
  })

  it("refetches with the selected status when the status filter changes", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyCommissions)
    })
    const user = userEvent.setup()

    renderPage()
    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", expect.anything())
    )

    const comboboxes = screen.getAllByRole("combobox")
    await user.click(comboboxes[1])
    await user.click(await screen.findByRole("option", { name: "Pago" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", {
        query: { limit: 20, offset: 0, status: "paid" },
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../page'` (the page component doesn't exist yet).

- [ ] **Step 3: Write the page**

Create `packages/medusa-backend/apps/backend/src/admin/routes/commissions/page.tsx`:

```tsx
import { useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import { Container, Heading, Select, StatusBadge, Table, Text } from "@medusajs/ui"
import { useAdminCommissions } from "../../hooks/commissions"
import { useAdminSellers } from "../../hooks/sellers"

const PAGE_SIZE = 20
const ALL_SELLERS = "all"
const ALL_STATUSES = "all"

const STATUS_LABELS: Record<"pending" | "paid", string> = {
  pending: "Pendente",
  paid: "Pago",
}

const STATUS_COLORS: Record<"pending" | "paid", "orange" | "green"> = {
  pending: "orange",
  paid: "green",
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function TotalCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-lg border border-ui-border-base p-4">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="xlarge" weight="plus">
        {formatBRL(value)}
      </Text>
    </div>
  )
}

function CommissionsPage() {
  const [sellerId, setSellerId] = useState(ALL_SELLERS)
  const [status, setStatus] = useState(ALL_STATUSES)
  const [pageIndex, setPageIndex] = useState(0)

  const { data: sellersData } = useAdminSellers({})
  const sellers = sellersData?.sellers ?? []

  const filters: { seller_id?: string; status?: string; limit: number; offset: number } = {
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  }
  if (sellerId !== ALL_SELLERS) filters.seller_id = sellerId
  if (status !== ALL_STATUSES) filters.status = status

  const { data, isLoading, isError } = useAdminCommissions(filters)
  const commissions = data?.commissions ?? []
  const totals = data?.totals ?? { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 }
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Comissões</Heading>
        <div className="flex gap-2">
          <Select
            value={sellerId}
            onValueChange={(value) => {
              setSellerId(value)
              setPageIndex(0)
            }}
          >
            <Select.Trigger className="w-56">
              <Select.Value placeholder="Todos os vendedores" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={ALL_SELLERS}>Todos os vendedores</Select.Item>
              {sellers.map((seller) => (
                <Select.Item key={seller.id} value={seller.id}>
                  {seller.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value)
              setPageIndex(0)
            }}
          >
            <Select.Trigger className="w-40">
              <Select.Value placeholder="Todos" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={ALL_STATUSES}>Todos</Select.Item>
              <Select.Item value="pending">Pendente</Select.Item>
              <Select.Item value="paid">Pago</Select.Item>
            </Select.Content>
          </Select>
        </div>
      </div>

      <div className="flex gap-4 px-6 pb-4">
        <TotalCard label="GMV bruto" value={totals.grossAmount} />
        <TotalCard label="Comissão retida" value={totals.commissionAmount} />
        <TotalCard label="Repasse aos vendedores" value={totals.sellerPayout} />
      </div>

      {isError && (
        <div className="px-6 py-8 text-center">
          <Text>Não foi possível carregar as comissões. Tente novamente.</Text>
        </div>
      )}

      {!isError && !isLoading && commissions.length === 0 && (
        <div className="px-6 py-8 text-center">
          <Text>Nenhuma comissão encontrada.</Text>
        </div>
      )}

      {commissions.length > 0 && (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Pedido</Table.HeaderCell>
                <Table.HeaderCell>Vendedor</Table.HeaderCell>
                <Table.HeaderCell>Valor bruto</Table.HeaderCell>
                <Table.HeaderCell>Comissão</Table.HeaderCell>
                <Table.HeaderCell>Repasse</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {commissions.map((commission) => (
                <Table.Row key={commission.id}>
                  <Table.Cell>{commission.orderId}</Table.Cell>
                  <Table.Cell>{commission.sellerName}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.grossAmount)}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.commissionAmount)}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.sellerPayout)}</Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={STATUS_COLORS[commission.status]}>
                      {STATUS_LABELS[commission.status]}
                    </StatusBadge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <Table.Pagination
            count={count}
            pageSize={PAGE_SIZE}
            pageIndex={pageIndex}
            pageCount={pageCount}
            canPreviousPage={pageIndex > 0}
            canNextPage={pageIndex < pageCount - 1}
            previousPage={() => setPageIndex((p) => Math.max(0, p - 1))}
            nextPage={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
          />
        </>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Comissões",
  icon: CurrencyDollar,
})

export default CommissionsPage
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 6/6 new tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/admin/routes/commissions
git commit -m "feat(admin): add commissions list route"
```

---

### Task 7: Final verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full backend Jest suite**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit`
Expected: PASS — all existing tests plus the new ones from Tasks 1–4 (12 new: 4 service + 2 payout-create + 3 payout-process + 3 commissions-route).

- [ ] **Step 2: Run the full admin Vitest suite**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — all prior admin tests plus the new ones from Tasks 5–6 (7 new: 1 hook + 6 page).

- [ ] **Step 3: Typecheck the backend**

Run: `cd packages/medusa-backend/apps/backend && npx tsc --noEmit`
Expected: no new errors attributable to any file touched in this plan. (The pre-existing, unrelated error in `src/scripts/nuvemshop-import/__tests__/client.unit.spec.ts` will still appear — that is expected and out of scope, already documented in the Vendedores plan's final review.)

- [ ] **Step 4: Build the admin extension**

Run: `cd packages/medusa-backend/apps/backend && npx medusa build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Manual smoke test in the browser**

Start the dev server (`npx medusa develop` from `packages/medusa-backend/apps/backend`, with local Postgres/Redis/Meilisearch running — see the Vendedores plan's Task 7 for how this was set up locally), then in a browser:
1. Log in to `/app` as admin.
2. Confirm "Comissões" appears in the sidebar.
3. Open it — confirm it loads with no status/seller pre-filter, showing totals cards.
4. If any commissions exist, confirm the table renders with seller names (not raw IDs).
5. Change the status filter to "Pago" and confirm the list/totals update.
6. Change the seller filter and confirm the list/totals update.
7. If there are more than 20 commissions, confirm pagination controls work (Next/Previous).
8. **End-to-end link verification:** create a payout for a seller with pending commissions via `POST /admin/sellers` flow data (or curl `POST /admin/payouts` directly with a real `sellerId`/period covering existing commissions), then process it (`POST /admin/payouts/:id/process`), then reload the Comissões screen and confirm the previously-`pending` commissions for that seller/period now show `"Pago"`.

Expected: all steps work with no console errors, matching the behavior verified in the automated tests.

- [ ] **Step 6: Commit if any fix was needed**

If steps 1–5 required no code changes, there is nothing to commit — this task is verification-only. If a fix was needed, commit it with an appropriate `fix(admin): ...` or `fix(backend): ...` message before proceeding.
