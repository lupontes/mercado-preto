# Admin Payouts Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the third of four planned admin UI subsystems — a Payouts screen (list + detail) that lets the admin create, process, and cancel repasses to sellers, closing the Commission↔Payout linking gap documented in the Commissions spec.

**Architecture:** Backend: a new `"cancelled"` Payout status, two new `PayoutModuleService` methods, a refactor + three new `CommissionModuleService` methods, a rewritten `POST /admin/payouts` (server-calculated amount, maturation-window validation), a new preview endpoint, a new detail endpoint, a new cancel endpoint, and bidirectional linking added to the `commission-on-payment` subscriber. Frontend: hooks + a list page with filters/totals/pagination + a create-payout modal with live preview + a detail page with banking/PIX data and confirm-dialog actions — all following the exact patterns established in the Sellers and Commissions subsystems.

**Tech Stack:** Medusa v2 (`@medusajs/framework`, `@medusajs/admin-sdk`, `@medusajs/js-sdk`, `@medusajs/ui`, `@medusajs/icons`), Zod, TanStack Query v5, React Router v6, Jest (backend), Vitest (admin frontend).

## Global Constraints

- Maturation window is a fixed constant: `MATURATION_WINDOW_DAYS = 5`. `POST /admin/payouts` rejects (400) any `periodEnd` more recent than `now - 5 days`.
- The payout `amount` is always calculated server-side from unlinked pending commissions in the period — never accepted from the client. `CreatePayoutSchema` has no `amount` field.
- A payout whose calculated amount is `<= 0` cannot be created (400, "Nenhuma comissão pendente neste período").
- Bidirectional linking (in the `commission-on-payment` subscriber) only attaches a late commission to a `"pending"` payout, never to a `"completed"` one. When it attaches, it also increments that payout's `amount`.
- Cancellation is only allowed when `status === "pending"` (409 otherwise). Cancelling unlinks all commissions from that payout (`payoutId: null`) and sets the payout's status to the new `"cancelled"` value — distinct from `"failed"`.
- Backend tests: Jest, `**/__tests__/**/*.unit.spec.ts`, using the `makeScope`/`makeRes` helpers already established in `src/api/admin/payouts/__tests__/route.unit.spec.ts` and the `jest.mock("@medusajs/framework/utils", ...)` service-mock pattern already established in `src/modules/commission/__tests__/service.unit.spec.ts`.
- Frontend tests: Vitest, `.test.tsx` naming, `vi.mock("../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn() } } }))`.
- Radix `Select.Item` never gets `value=""` — use sentinel strings (`"all"`) for "todos" options, exactly as done in Sellers/Commissions.
- All new/changed backend routes resolve modules via `req.scope.resolve(MODULE_CONSTANT)`, matching the exact import/resolve pattern already used in `src/api/admin/payouts/route.ts` and `src/api/admin/commissions/route.ts`.

---

### Task 1: Payout status `"cancelled"` + migration + service methods

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/modules/payout/models/payout.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/payout/migrations/Migration20260711160000.ts`
- Modify: `packages/medusa-backend/apps/backend/src/modules/payout/service.ts`
- Test: `packages/medusa-backend/apps/backend/src/modules/payout/__tests__/service.unit.spec.ts` (new)

**Interfaces:**
- Produces: `PayoutModuleService.cancelPayout(id: string): Promise<any>`, `PayoutModuleService.incrementAmount(id: string, delta: number): Promise<any>` — consumed by Task 7 (cancel route) and Task 8 (subscriber).

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/modules/payout/__tests__/service.unit.spec.ts`:

```ts
jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        listPayouts = jest.fn()
        updatePayouts = jest.fn()
      },
  }
})

import PayoutModuleService from "../service"

function makeService() {
  const svc = new PayoutModuleService() as any
  return svc as PayoutModuleService & {
    listPayouts: jest.Mock
    updatePayouts: jest.Mock
  }
}

describe("PayoutModuleService.cancelPayout", () => {
  it("sets status to cancelled", async () => {
    const svc = makeService()
    svc.updatePayouts.mockResolvedValue([{ id: "payout_1", status: "cancelled" }])

    await svc.cancelPayout("payout_1")

    expect(svc.updatePayouts).toHaveBeenCalledWith({
      selector: { id: "payout_1" },
      data: { status: "cancelled" },
    })
  })
})

describe("PayoutModuleService.incrementAmount", () => {
  it("adds the delta to the current amount", async () => {
    const svc = makeService()
    svc.listPayouts.mockResolvedValue([{ id: "payout_1", amount: 1000 }])
    svc.updatePayouts.mockResolvedValue([{ id: "payout_1", amount: 1500 }])

    await svc.incrementAmount("payout_1", 500)

    expect(svc.listPayouts).toHaveBeenCalledWith({ id: "payout_1" })
    expect(svc.updatePayouts).toHaveBeenCalledWith({
      selector: { id: "payout_1" },
      data: { amount: 1500 },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/payout/__tests__/service.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL — `svc.cancelPayout is not a function` / `svc.incrementAmount is not a function`.

- [ ] **Step 3: Update the model**

Current content of `packages/medusa-backend/apps/backend/src/modules/payout/models/payout.ts`:

```ts
import { model } from "@medusajs/framework/utils"

const Payout = model.define("payout", {
  id: model.id().primaryKey(),
  sellerId: model.text(),
  amount: model.bigNumber(),
  periodStart: model.dateTime(),
  periodEnd: model.dateTime(),
  status: model.enum(["pending", "processing", "completed", "failed"]).default("pending"),
  processedAt: model.dateTime().nullable(),
  notes: model.text().nullable(),
})

export default Payout
```

Replace the `status` line with:

```ts
  status: model.enum(["pending", "processing", "completed", "failed", "cancelled"]).default("pending"),
```

- [ ] **Step 4: Write the migration**

Create `packages/medusa-backend/apps/backend/src/modules/payout/migrations/Migration20260711160000.ts`:

```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payout" drop constraint if exists "payout_status_check";`);
    this.addSql(`alter table if exists "payout" add constraint "payout_status_check" check ("status" in ('pending', 'processing', 'completed', 'failed', 'cancelled'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payout" drop constraint if exists "payout_status_check";`);
    this.addSql(`alter table if exists "payout" add constraint "payout_status_check" check ("status" in ('pending', 'processing', 'completed', 'failed'));`);
  }

}
```

- [ ] **Step 5: Add the two service methods**

Current content of `packages/medusa-backend/apps/backend/src/modules/payout/service.ts`:

```ts
import { MedusaService } from "@medusajs/framework/utils"
import Payout from "./models/payout"

class PayoutModuleService extends MedusaService({ Payout }) {
  async markAsProcessed(id: string): Promise<any> {
    const [payout] = await this.updatePayouts({
      selector: { id },
      data: { status: "completed" as const, processedAt: new Date() },
    })
    return payout
  }
}

export default PayoutModuleService
```

Replace entirely with:

```ts
import { MedusaService } from "@medusajs/framework/utils"
import Payout from "./models/payout"

class PayoutModuleService extends MedusaService({ Payout }) {
  async markAsProcessed(id: string): Promise<any> {
    const [payout] = await this.updatePayouts({
      selector: { id },
      data: { status: "completed" as const, processedAt: new Date() },
    })
    return payout
  }

  async cancelPayout(id: string): Promise<any> {
    const [payout] = await this.updatePayouts({
      selector: { id },
      data: { status: "cancelled" as const },
    })
    return payout
  }

  async incrementAmount(id: string, delta: number): Promise<any> {
    const [current] = await this.listPayouts({ id })
    const [payout] = await this.updatePayouts({
      selector: { id },
      data: { amount: Number(current.amount) + delta },
    })
    return payout
  }
}

export default PayoutModuleService
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/payout/__tests__/service.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — 2/2 tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/payout
git commit -m "feat(backend): add cancelled payout status and cancel/increment service methods"
```

---

### Task 2: CommissionModuleService — shared filter refactor + three new methods

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/modules/commission/service.ts`
- Modify (extend, don't remove existing tests): `packages/medusa-backend/apps/backend/src/modules/commission/__tests__/service.unit.spec.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `CommissionModuleService.sumUnlinkedPendingInPeriod(sellerId: string, periodStart: Date, periodEnd: Date): Promise<{ amount: number; commissionCount: number }>` — consumed by Task 4 (preview) and Task 5 (POST rewrite). `CommissionModuleService.unlinkByPayout(payoutId: string): Promise<void>` — consumed by Task 7 (cancel route). `CommissionModuleService.linkSingleCommissionToPayout(commissionId: string, payoutId: string): Promise<void>` — consumed by Task 8 (subscriber).

- [ ] **Step 1: Write the failing tests**

Current content of `packages/medusa-backend/apps/backend/src/modules/commission/__tests__/service.unit.spec.ts` ends with the `markPaidByPayout` describe block. Append these three new describe blocks at the end of the file (after the closing `})` of `describe("CommissionModuleService.markPaidByPayout", ...)`):

```ts

describe("CommissionModuleService.sumUnlinkedPendingInPeriod", () => {
  it("sums sellerPayout for pending, unlinked commissions within the period", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([
      { id: "comm_1", sellerId: "seller_1", sellerPayout: 800, created_at: "2026-07-05T00:00:00.000Z" },
      { id: "comm_2", sellerId: "seller_1", sellerPayout: 200, created_at: "2026-07-20T00:00:00.000Z" },
    ])

    const result = await svc.sumUnlinkedPendingInPeriod(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T23:59:59.999Z")
    )

    expect(svc.listCommissions).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending", payoutId: null })
    expect(result).toEqual({ amount: 800, commissionCount: 1 })
  })

  it("returns zero when there are no pending commissions in the period", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([])

    const result = await svc.sumUnlinkedPendingInPeriod(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T00:00:00.000Z")
    )

    expect(result).toEqual({ amount: 0, commissionCount: 0 })
  })
})

describe("CommissionModuleService.unlinkByPayout", () => {
  it("clears payoutId on all commissions linked to the payout", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([
      { id: "comm_1", payoutId: "payout_1" },
      { id: "comm_2", payoutId: "payout_1" },
    ])
    svc.updateCommissions.mockResolvedValue([{}])

    await svc.unlinkByPayout("payout_1")

    expect(svc.listCommissions).toHaveBeenCalledWith({ payoutId: "payout_1" })
    expect(svc.updateCommissions).toHaveBeenCalledTimes(2)
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_1" },
      data: { payoutId: null },
    })
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_2" },
      data: { payoutId: null },
    })
  })

  it("does nothing when no commissions are linked to the payout", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([])

    await svc.unlinkByPayout("payout_empty")

    expect(svc.updateCommissions).not.toHaveBeenCalled()
  })
})

describe("CommissionModuleService.linkSingleCommissionToPayout", () => {
  it("sets payoutId on the given commission", async () => {
    const svc = makeService()
    svc.updateCommissions.mockResolvedValue([{}])

    await svc.linkSingleCommissionToPayout("comm_1", "payout_2")

    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_1" },
      data: { payoutId: "payout_2" },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/commission/__tests__/service.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL on the 5 new tests — `svc.sumUnlinkedPendingInPeriod is not a function`, etc. The existing `linkPendingToPayout`/`markPaidByPayout` tests still PASS (untouched).

- [ ] **Step 3: Refactor and add the methods**

Current content of `packages/medusa-backend/apps/backend/src/modules/commission/service.ts`:

```ts
import { MedusaService } from "@medusajs/framework/utils"
import Commission from "./models/commission"
import MarketplaceConfig from "./models/marketplace-config"

type CalculateInput = {
  orderId: string
  sellerId: string
  grossAmount: number
  bankingFees: number
  commissionRate?: number
}

class CommissionModuleService extends MedusaService({ Commission, MarketplaceConfig }) {
  async getCommissionRate(): Promise<number> {
    try {
      const configs = await this.listMarketplaceConfigs({ key: "commission_rate" })
      if (configs[0]) return Number(configs[0].value)
    } catch {}
    return Number(process.env.MARKETPLACE_COMMISSION_RATE ?? 15)
  }

  async setCommissionRate(rate: number): Promise<void> {
    const configs = await this.listMarketplaceConfigs({ key: "commission_rate" })
    if (configs[0]) {
      await this.updateMarketplaceConfigs({
        selector: { id: configs[0].id },
        data: { value: String(rate) },
      })
    } else {
      await this.createMarketplaceConfigs({ key: "commission_rate", value: String(rate) })
    }
  }

  async calculate(input: CalculateInput) {
    const rate = input.commissionRate ?? await this.getCommissionRate()

    const netAmount = input.grossAmount - input.bankingFees
    const commissionAmount = Math.round(netAmount * (rate / 100))
    const sellerPayout = netAmount - commissionAmount

    return {
      orderId: input.orderId,
      sellerId: input.sellerId,
      grossAmount: input.grossAmount,
      bankingFees: input.bankingFees,
      netAmount,
      commissionRate: rate,
      commissionAmount,
      sellerPayout,
    }
  }

  async recordAndCreate(input: CalculateInput) {
    const calculated = await this.calculate(input)
    const commission = await this.createCommissions(calculated as any)
    return commission
  }

  async markAsPaid(id: string) {
    const [commission] = await this.updateCommissions({
      selector: { id },
      data: { status: "paid" as const, paidAt: new Date() },
    })
    return commission
  }

  async linkPendingToPayout(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date,
    payoutId: string
  ): Promise<void> {
    const pending = await this.listCommissions({ sellerId, status: "pending", payoutId: null })
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
}

export default CommissionModuleService
```

Replace entirely with:

```ts
import { MedusaService } from "@medusajs/framework/utils"
import Commission from "./models/commission"
import MarketplaceConfig from "./models/marketplace-config"

type CalculateInput = {
  orderId: string
  sellerId: string
  grossAmount: number
  bankingFees: number
  commissionRate?: number
}

class CommissionModuleService extends MedusaService({ Commission, MarketplaceConfig }) {
  async getCommissionRate(): Promise<number> {
    try {
      const configs = await this.listMarketplaceConfigs({ key: "commission_rate" })
      if (configs[0]) return Number(configs[0].value)
    } catch {}
    return Number(process.env.MARKETPLACE_COMMISSION_RATE ?? 15)
  }

  async setCommissionRate(rate: number): Promise<void> {
    const configs = await this.listMarketplaceConfigs({ key: "commission_rate" })
    if (configs[0]) {
      await this.updateMarketplaceConfigs({
        selector: { id: configs[0].id },
        data: { value: String(rate) },
      })
    } else {
      await this.createMarketplaceConfigs({ key: "commission_rate", value: String(rate) })
    }
  }

  async calculate(input: CalculateInput) {
    const rate = input.commissionRate ?? await this.getCommissionRate()

    const netAmount = input.grossAmount - input.bankingFees
    const commissionAmount = Math.round(netAmount * (rate / 100))
    const sellerPayout = netAmount - commissionAmount

    return {
      orderId: input.orderId,
      sellerId: input.sellerId,
      grossAmount: input.grossAmount,
      bankingFees: input.bankingFees,
      netAmount,
      commissionRate: rate,
      commissionAmount,
      sellerPayout,
    }
  }

  async recordAndCreate(input: CalculateInput) {
    const calculated = await this.calculate(input)
    const commission = await this.createCommissions(calculated as any)
    return commission
  }

  async markAsPaid(id: string) {
    const [commission] = await this.updateCommissions({
      selector: { id },
      data: { status: "paid" as const, paidAt: new Date() },
    })
    return commission
  }

  private async findUnlinkedPendingInPeriod(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date
  ) {
    const pending = await this.listCommissions({ sellerId, status: "pending", payoutId: null })
    return pending.filter((c: any) => {
      const created = new Date(c.created_at)
      return created >= periodStart && created <= periodEnd
    })
  }

  async linkPendingToPayout(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date,
    payoutId: string
  ): Promise<void> {
    const inPeriod = await this.findUnlinkedPendingInPeriod(sellerId, periodStart, periodEnd)
    for (const commission of inPeriod) {
      await this.updateCommissions({
        selector: { id: commission.id },
        data: { payoutId },
      })
    }
  }

  async sumUnlinkedPendingInPeriod(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{ amount: number; commissionCount: number }> {
    const inPeriod = await this.findUnlinkedPendingInPeriod(sellerId, periodStart, periodEnd)
    const amount = inPeriod.reduce((acc: number, c: any) => acc + Number(c.sellerPayout), 0)
    return { amount, commissionCount: inPeriod.length }
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

  async unlinkByPayout(payoutId: string): Promise<void> {
    const linked = await this.listCommissions({ payoutId })
    for (const commission of linked) {
      await this.updateCommissions({
        selector: { id: commission.id },
        data: { payoutId: null },
      })
    }
  }

  async linkSingleCommissionToPayout(commissionId: string, payoutId: string): Promise<void> {
    await this.updateCommissions({
      selector: { id: commissionId },
      data: { payoutId },
    })
  }
}

export default CommissionModuleService
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/commission/__tests__/service.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — all tests green, including the pre-existing `linkPendingToPayout`/`markPaidByPayout` tests (unaffected by the refactor since the observable `listCommissions`/`updateCommissions` call shapes are unchanged) and the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/modules/commission
git commit -m "feat(backend): add commission sum/unlink/single-link methods, share period filter"
```

---

### Task 3: `GET /admin/payouts` — total/count reais + sellerName

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts` (só a função `GET` — `POST` fica intocado nesta task)
- Modify (adicionar, não substituir): `packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: resposta de `GET /admin/payouts` passa a ser `{ payouts: (Payout & { sellerName: string })[], total: number, count: number, limit: number, offset: number }` — consumido pelo hook `useAdminPayouts` (Task 9).

- [ ] **Step 1: Escrever o teste que falha**

Conteúdo atual de `packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts` termina com o describe de `POST /admin/payouts`. Adicione este novo describe block ANTES do `describe("POST /admin/payouts", ...)` existente (a ordem não importa para o Jest, mas mantenha o arquivo organizado com GET primeiro):

```ts
import { GET, POST } from "../route"
```

Troque a linha `import { POST } from "../route"` (linha 1 do arquivo atual) por `import { GET, POST } from "../route"`.

Depois, adicione este describe block logo após as funções `makeScope`/`makeRes` (antes do `describe("POST /admin/payouts", ...)`):

```ts
describe("GET /admin/payouts", () => {
  it("enriches each payout with the seller's name", async () => {
    const payout = { id: "payout_1", sellerId: "seller_1", amount: 10000 }
    const listPayouts = jest.fn()
      .mockResolvedValueOnce([payout])
      .mockResolvedValueOnce([payout])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: {},
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listSellers).toHaveBeenCalledWith({ id: ["seller_1"] })
    expect(res._body.payouts[0].sellerName).toBe("Loja Teste")
  })

  it("falls back to a placeholder name when the seller no longer exists", async () => {
    const payout = { id: "payout_1", sellerId: "seller_deleted", amount: 10000 }
    const listPayouts = jest.fn()
      .mockResolvedValueOnce([payout])
      .mockResolvedValueOnce([payout])
    const listSellers = jest.fn().mockResolvedValue([])
    const req = {
      query: {},
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.payouts[0].sellerName).toBe("Vendedor removido")
  })

  it("returns the real total and count, not just the current page", async () => {
    const p1 = { id: "payout_1", sellerId: "seller_1", amount: 10000 }
    const p2 = { id: "payout_2", sellerId: "seller_1", amount: 5000 }
    const p3 = { id: "payout_3", sellerId: "seller_1", amount: 5000 }
    const listPayouts = jest.fn()
      .mockResolvedValueOnce([p1])
      .mockResolvedValueOnce([p1, p2, p3])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: { limit: "1" },
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.count).toBe(3)
    expect(res._body.total).toBe(20000)
  })
})

```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL — `GET is not exported` / `res._body.payouts` undefined (a rota `GET` atual não enriquece nem retorna `total`/`count` reais).

- [ ] **Step 3: Reescrever a função GET**

Conteúdo atual de `packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { PAYOUT_MODULE } from "../../../modules/payout"
import { COMMISSION_MODULE } from "../../../modules/commission"
import PayoutModuleService from "../../../modules/payout/service"
import CommissionModuleService from "../../../modules/commission/service"

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

Substitua inteiramente por (só o `GET` mudou; `CreatePayoutSchema` e `POST` continuam byte a byte iguais — serão reescritos na Task 5):

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { PAYOUT_MODULE } from "../../../modules/payout"
import { COMMISSION_MODULE } from "../../../modules/commission"
import { SELLER_MODULE } from "../../../modules/seller"
import PayoutModuleService from "../../../modules/payout/service"
import CommissionModuleService from "../../../modules/commission/service"
import SellerModuleService from "../../../modules/seller/service"

const CreatePayoutSchema = z.object({
  sellerId: z.string(),
  amount: z.number().int().positive(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { seller_id, status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status

  const payouts = await payoutService.listPayouts(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const allMatching = await payoutService.listPayouts(filters)
  const count = allMatching.length
  const total = allMatching.reduce((acc: number, p: any) => acc + Number(p.amount), 0)

  const sellerIds = [...new Set(payouts.map((p: any) => p.sellerId))]
  const sellers = sellerIds.length > 0 ? await sellerService.listSellers({ id: sellerIds }) : []
  const sellerNameById = new Map(sellers.map((s: any) => [s.id, s.name]))

  const enrichedPayouts = payouts.map((p: any) => ({
    ...p,
    sellerName: sellerNameById.get(p.sellerId) ?? "Vendedor removido",
  }))

  res.json({ payouts: enrichedPayouts, total, count, limit: Number(limit), offset: Number(offset) })
}

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

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — 3 novos testes de GET + 2 testes de POST existentes, todos verdes (5/5).

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts
git commit -m "fix(backend): enrich payouts list with seller name and real total/count"
```

---

### Task 4: `GET /admin/payouts/preview` (novo)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/admin/payouts/preview/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/payouts/preview/__tests__/route.unit.spec.ts` (novo)

**Interfaces:**
- Consumes: `CommissionModuleService.sumUnlinkedPendingInPeriod(sellerId, periodStart, periodEnd)` (Task 2).
- Produces: `GET /admin/payouts/preview` retorna `{ periodStart: string, periodEnd: string, amount: number, commissionCount: number }` — consumido pelo hook `useAdminPayoutPreview` (Task 9).

- [ ] **Step 1: Escrever o teste que falha**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/preview/__tests__/route.unit.spec.ts`:

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

describe("GET /admin/payouts/preview", () => {
  it("returns 400 when seller_id is missing", async () => {
    const req = { query: {}, scope: makeScope({ payout: {}, commission: {} }) } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._status).toBe(400)
  })

  it("calculates the amount for an explicit period without suggesting one", async () => {
    const listPayouts = jest.fn()
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 1500, commissionCount: 2 })
    const req = {
      query: {
        seller_id: "seller_1",
        period_start: "2026-07-01T00:00:00.000Z",
        period_end: "2026-07-10T00:00:00.000Z",
      },
      scope: makeScope({
        payout: { listPayouts },
        commission: { sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listPayouts).not.toHaveBeenCalled()
    expect(sumUnlinkedPendingInPeriod).toHaveBeenCalledWith(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T00:00:00.000Z")
    )
    expect(res._body).toEqual({
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-10T00:00:00.000Z",
      amount: 1500,
      commissionCount: 2,
    })
  })

  it("suggests the period since the last completed payout when one exists", async () => {
    const listPayouts = jest.fn().mockResolvedValue([
      { id: "payout_1", periodEnd: "2026-06-15T00:00:00.000Z" },
    ])
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 900, commissionCount: 1 })
    const req = {
      query: { seller_id: "seller_1" },
      scope: makeScope({
        payout: { listPayouts },
        commission: { sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listPayouts).toHaveBeenCalledWith(
      { sellerId: "seller_1", status: "completed" },
      { order: { periodEnd: "DESC" }, take: 1 }
    )
    expect(res._body.periodStart).toBe("2026-06-15T00:00:00.000Z")
    expect(res._body.amount).toBe(900)
  })

  it("suggests the period since the earliest pending commission when there is no completed payout", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const listCommissions = jest.fn().mockResolvedValue([
      { id: "comm_1", created_at: "2026-06-20T00:00:00.000Z" },
    ])
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 300, commissionCount: 1 })
    const req = {
      query: { seller_id: "seller_1" },
      scope: makeScope({
        payout: { listPayouts },
        commission: { listCommissions, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listCommissions).toHaveBeenCalledWith(
      { sellerId: "seller_1", status: "pending", payoutId: null },
      { order: { created_at: "ASC" }, take: 1 }
    )
    expect(res._body.periodStart).toBe("2026-06-20T00:00:00.000Z")
  })

  it("suggests a zero-length period when the seller has neither a completed payout nor a pending commission", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const listCommissions = jest.fn().mockResolvedValue([])
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 0, commissionCount: 0 })
    const req = {
      query: { seller_id: "seller_1" },
      scope: makeScope({
        payout: { listPayouts },
        commission: { listCommissions, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.periodStart).toBe(res._body.periodEnd)
    expect(res._body.amount).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/preview --silent --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../route'` (o arquivo ainda não existe).

- [ ] **Step 3: Criar a rota**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/preview/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYOUT_MODULE } from "../../../../modules/payout"
import { COMMISSION_MODULE } from "../../../../modules/commission"
import PayoutModuleService from "../../../../modules/payout/service"
import CommissionModuleService from "../../../../modules/commission/service"

const MATURATION_WINDOW_DAYS = 5

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)

  const { seller_id, period_start, period_end } = req.query as Record<string, string>
  if (!seller_id) {
    return res.status(400).json({ error: "seller_id é obrigatório" })
  }

  let periodStart: Date
  let periodEnd: Date

  if (period_start && period_end) {
    periodStart = new Date(period_start)
    periodEnd = new Date(period_end)
  } else {
    periodEnd = new Date(Date.now() - MATURATION_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    const [lastCompleted] = await payoutService.listPayouts(
      { sellerId: seller_id, status: "completed" },
      { order: { periodEnd: "DESC" }, take: 1 }
    )
    if (lastCompleted) {
      periodStart = new Date(lastCompleted.periodEnd)
    } else {
      const [earliestPending] = await commissionService.listCommissions(
        { sellerId: seller_id, status: "pending", payoutId: null },
        { order: { created_at: "ASC" }, take: 1 }
      )
      periodStart = earliestPending ? new Date(earliestPending.created_at) : periodEnd
    }
  }

  const { amount, commissionCount } = await commissionService.sumUnlinkedPendingInPeriod(
    seller_id,
    periodStart,
    periodEnd
  )

  res.json({
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    amount,
    commissionCount,
  })
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/preview --silent --runInBand --forceExit`
Expected: PASS — 5/5 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/payouts/preview
git commit -m "feat(backend): add payout amount/period preview endpoint"
```

---

### Task 5: `POST /admin/payouts` — reescrita (sem amount, janela de maturação, bloqueio de valor zero)

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts` (só `CreatePayoutSchema` e `POST` — `GET`, escrito na Task 3, fica intocado)
- Modify (substituir o describe de POST): `packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `CommissionModuleService.sumUnlinkedPendingInPeriod` (Task 2).
- Produces: `POST /admin/payouts` não aceita mais `amount` no body; calcula no servidor. Contrato consumido pelo `useCreatePayout` (Task 9) e pelo `CreatePayoutModal` (Task 10).

- [ ] **Step 1: Escrever os testes que falham**

Substitua inteiramente o describe block `describe("POST /admin/payouts", ...)` em `packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts` (mantendo o describe de `GET /admin/payouts` da Task 3 intocado) por:

```ts
describe("POST /admin/payouts", () => {
  it("creates the payout with the calculated amount and links pending commissions in the period", async () => {
    const createPayouts = jest.fn().mockResolvedValue({ id: "payout_1", sellerId: "seller_1" })
    const linkPendingToPayout = jest.fn().mockResolvedValue(undefined)
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 8200, commissionCount: 2 })
    const req = {
      body: {
        sellerId: "seller_1",
        periodStart: "2020-01-01T00:00:00.000Z",
        periodEnd: "2020-01-10T00:00:00.000Z",
      },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(sumUnlinkedPendingInPeriod).toHaveBeenCalledWith(
      "seller_1",
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2020-01-10T00:00:00.000Z")
    )
    expect(createPayouts).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: "seller_1", amount: 8200 })
    )
    expect(linkPendingToPayout).toHaveBeenCalledWith(
      "seller_1",
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2020-01-10T00:00:00.000Z"),
      "payout_1"
    )
    expect(res._status).toBe(201)
  })

  it("returns 400 and does not create a payout when body is invalid", async () => {
    const createPayouts = jest.fn()
    const linkPendingToPayout = jest.fn()
    const sumUnlinkedPendingInPeriod = jest.fn()
    const req = {
      body: { sellerId: "seller_1" },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(createPayouts).not.toHaveBeenCalled()
    expect(sumUnlinkedPendingInPeriod).not.toHaveBeenCalled()
  })

  it("returns 400 and does not create a payout when the period has not matured yet", async () => {
    const createPayouts = jest.fn()
    const linkPendingToPayout = jest.fn()
    const sumUnlinkedPendingInPeriod = jest.fn()
    const now = new Date()
    const periodEnd = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) // 1 dia atrás, dentro da janela de 5 dias
    const req = {
      body: {
        sellerId: "seller_1",
        periodStart: "2020-01-01T00:00:00.000Z",
        periodEnd: periodEnd.toISOString(),
      },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(sumUnlinkedPendingInPeriod).not.toHaveBeenCalled()
    expect(createPayouts).not.toHaveBeenCalled()
  })

  it("returns 400 and does not create a payout when the calculated amount is zero", async () => {
    const createPayouts = jest.fn()
    const linkPendingToPayout = jest.fn()
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 0, commissionCount: 0 })
    const req = {
      body: {
        sellerId: "seller_1",
        periodStart: "2020-01-01T00:00:00.000Z",
        periodEnd: "2020-01-10T00:00:00.000Z",
      },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(createPayouts).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL — `sumUnlinkedPendingInPeriod` nunca é chamado (o `POST` atual ainda valida `amount` no schema e nunca calcula nada); os testes de `GET` continuam passando.

- [ ] **Step 3: Reescrever `CreatePayoutSchema` e `POST`**

O conteúdo atual do arquivo (após a Task 3) tem `GET` já corrigido e `POST` ainda com o schema antigo. Substitua a declaração de `CreatePayoutSchema` e a função `POST` inteira por:

```ts
const CreatePayoutSchema = z.object({
  sellerId: z.string(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().optional(),
})

const MATURATION_WINDOW_DAYS = 5
```

(substitui o antigo `CreatePayoutSchema`, que tinha o campo `amount`)

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

  const maturationCutoff = new Date(Date.now() - MATURATION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  if (periodEnd > maturationCutoff) {
    return res.status(400).json({
      error: `O período ainda não maturou. Aguarde ${MATURATION_WINDOW_DAYS} dias após o fim do período para criar o repasse.`,
    })
  }

  const { amount } = await commissionService.sumUnlinkedPendingInPeriod(
    parsed.data.sellerId,
    periodStart,
    periodEnd
  )
  if (amount <= 0) {
    return res.status(400).json({ error: "Nenhuma comissão pendente neste período" })
  }

  const payout = await payoutService.createPayouts({
    sellerId: parsed.data.sellerId,
    amount,
    periodStart,
    periodEnd,
    notes: parsed.data.notes,
  })

  await commissionService.linkPendingToPayout(parsed.data.sellerId, periodStart, periodEnd, payout.id)

  res.status(201).json({ payout })
}
```

(substitui o antigo `POST`, que espalhava `...parsed.data` — incluindo `amount` do cliente — direto em `createPayouts`)

O restante do arquivo (`imports`, `GET`) fica exatamente como ficou depois da Task 3.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/payouts/__tests__/route.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — 3 testes de GET + 4 testes de POST, todos verdes (7/7).

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/payouts/route.ts packages/medusa-backend/apps/backend/src/api/admin/payouts/__tests__/route.unit.spec.ts
git commit -m "feat(backend): calculate payout amount server-side and enforce maturation window"
```

---

### Task 6: `GET /admin/payouts/:id` (detalhe, novo)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/__tests__/route.unit.spec.ts` (novo)

**Interfaces:**
- Consumes: nada novo.
- Produces: `GET /admin/payouts/:id` retorna `{ payout: Payout & { sellerName: string }, seller: { id, name, bankName, bankAgency, bankAccount, bankAccountType, pixKey, pixKeyType } | null, commissions: Commission[] }` — consumido pelo hook `useAdminPayout` (Task 9) e pela página de detalhe (Task 11).

- [ ] **Step 1: Escrever o teste que falha**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/__tests__/route.unit.spec.ts`:

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

describe("GET /admin/payouts/:id", () => {
  it("returns 404 when the payout does not exist", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const req = {
      params: { id: "payout_missing" },
      scope: makeScope({ payout: { listPayouts }, seller: {}, commission: {} }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._status).toBe(404)
  })

  it("returns the payout enriched with seller banking data and linked commissions", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", sellerId: "seller_1", amount: 8200 }])
    const listSellers = jest.fn().mockResolvedValue([{
      id: "seller_1",
      name: "Mulheres de Axé do Brasil",
      bankName: "Banco do Brasil",
      bankAgency: "1234",
      bankAccount: "56789-0",
      bankAccountType: "checking",
      pixKey: "contato@mercadopreto.com.br",
      pixKeyType: "email",
    }])
    const listCommissions = jest.fn().mockResolvedValue([{ id: "comm_1", payoutId: "payout_1" }])
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
        commission: { listCommissions },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listSellers).toHaveBeenCalledWith({ id: "seller_1" })
    expect(listCommissions).toHaveBeenCalledWith({ payoutId: "payout_1" })
    expect(res._body.payout.sellerName).toBe("Mulheres de Axé do Brasil")
    expect(res._body.seller.pixKey).toBe("contato@mercadopreto.com.br")
    expect(res._body.commissions).toHaveLength(1)
  })

  it("falls back gracefully when the seller no longer exists", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", sellerId: "seller_deleted", amount: 100 }])
    const listSellers = jest.fn().mockResolvedValue([])
    const listCommissions = jest.fn().mockResolvedValue([])
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
        commission: { listCommissions },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.payout.sellerName).toBe("Vendedor removido")
    expect(res._body.seller).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest "src/api/admin/payouts/\[id\]/__tests__/route.unit.spec.ts" --silent --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Criar a rota**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYOUT_MODULE } from "../../../../modules/payout"
import { SELLER_MODULE } from "../../../../modules/seller"
import { COMMISSION_MODULE } from "../../../../modules/commission"
import PayoutModuleService from "../../../../modules/payout/service"
import SellerModuleService from "../../../../modules/seller/service"
import CommissionModuleService from "../../../../modules/commission/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const { id } = req.params

  const [payout] = await payoutService.listPayouts({ id })
  if (!payout) return res.status(404).json({ error: "Repasse não encontrado" })

  const [seller] = await sellerService.listSellers({ id: (payout as any).sellerId })
  const commissions = await commissionService.listCommissions({ payoutId: id })

  res.json({
    payout: { ...payout, sellerName: seller?.name ?? "Vendedor removido" },
    seller: seller
      ? {
          id: seller.id,
          name: seller.name,
          bankName: seller.bankName,
          bankAgency: seller.bankAgency,
          bankAccount: seller.bankAccount,
          bankAccountType: seller.bankAccountType,
          pixKey: seller.pixKey,
          pixKeyType: seller.pixKeyType,
        }
      : null,
    commissions,
  })
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest "src/api/admin/payouts/\[id\]/__tests__/route.unit.spec.ts" --silent --runInBand --forceExit`
Expected: PASS — 3/3 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add "packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/route.ts" "packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/__tests__/route.unit.spec.ts"
git commit -m "feat(backend): add payout detail endpoint with seller banking data"
```

---

### Task 7: `POST /admin/payouts/:id/cancel` (novo)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/cancel/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/cancel/__tests__/route.unit.spec.ts` (novo)

**Interfaces:**
- Consumes: `PayoutModuleService.cancelPayout` (Task 1), `CommissionModuleService.unlinkByPayout` (Task 2).
- Produces: `POST /admin/payouts/:id/cancel` — consumido pelo `useCancelPayout` (Task 9) e pelo dialog de cancelamento (Task 11).

- [ ] **Step 1: Escrever o teste que falha**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/cancel/__tests__/route.unit.spec.ts`:

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

describe("POST /admin/payouts/:id/cancel", () => {
  it("cancels the payout and unlinks its commissions", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "pending" }])
    const cancelPayout = jest.fn().mockResolvedValue({ id: "payout_1", status: "cancelled" })
    const unlinkByPayout = jest.fn().mockResolvedValue(undefined)
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, cancelPayout },
        commission: { unlinkByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(unlinkByPayout).toHaveBeenCalledWith("payout_1")
    expect(cancelPayout).toHaveBeenCalledWith("payout_1")
    expect(res._status).toBe(200)
  })

  it("returns 404 and does not cancel when the payout does not exist", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const cancelPayout = jest.fn()
    const unlinkByPayout = jest.fn()
    const req = {
      params: { id: "payout_missing" },
      scope: makeScope({
        payout: { listPayouts, cancelPayout },
        commission: { unlinkByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(unlinkByPayout).not.toHaveBeenCalled()
  })

  it("returns 409 and does not cancel when the payout is not pending", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "completed" }])
    const cancelPayout = jest.fn()
    const unlinkByPayout = jest.fn()
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, cancelPayout },
        commission: { unlinkByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(409)
    expect(unlinkByPayout).not.toHaveBeenCalled()
    expect(cancelPayout).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest "src/api/admin/payouts/\[id\]/cancel" --silent --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Criar a rota**

Create `packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/cancel/route.ts`:

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
  if (existing.status !== "pending") {
    return res.status(409).json({ error: "Só é possível cancelar um repasse pendente" })
  }

  await commissionService.unlinkByPayout(id)
  const payout = await payoutService.cancelPayout(id)

  res.json({ payout })
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest "src/api/admin/payouts/\[id\]/cancel" --silent --runInBand --forceExit`
Expected: PASS — 3/3 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add "packages/medusa-backend/apps/backend/src/api/admin/payouts/[id]/cancel"
git commit -m "feat(backend): add payout cancellation endpoint"
```

---

### Task 8: Vínculo bidirecional — `src/subscribers/commission-on-payment.ts`

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts`
- Test: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/commission-on-payment.unit.spec.ts` (novo — primeiro teste deste subscriber)

**Interfaces:**
- Consumes: `CommissionModuleService.linkSingleCommissionToPayout` (Task 2), `PayoutModuleService.incrementAmount` (Task 1).
- Produces: nada novo para outras tasks.

- [ ] **Step 1: Escrever o teste que falha**

Create `packages/medusa-backend/apps/backend/src/subscribers/__tests__/commission-on-payment.unit.spec.ts`:

```ts
import { Modules } from "@medusajs/framework/utils"
import commissionOnPayment from "../commission-on-payment"

function makeContainer(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

const baseOrder = {
  id: "order_1",
  total: 10000,
  metadata: { seller_id: "seller_1" },
}

describe("commissionOnPayment", () => {
  it("does nothing when the commission already exists (idempotency)", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const listCommissions = jest.fn().mockResolvedValue([{ id: "comm_existing" }])
    const recordAndCreate = jest.fn()
    const listPayouts = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions, recordAndCreate },
      payout: { listPayouts },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(recordAndCreate).not.toHaveBeenCalled()
    expect(listPayouts).not.toHaveBeenCalled()
  })

  it("links the new commission to a pending payout covering its period, and increments the payout amount", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = {
      id: "comm_new",
      created_at: "2026-07-05T00:00:00.000Z",
      sellerPayout: 700,
    }
    const recordAndCreate = jest.fn().mockResolvedValue(createdCommission)
    const linkSingleCommissionToPayout = jest.fn().mockResolvedValue(undefined)
    const listPayouts = jest.fn().mockResolvedValue([
      {
        id: "payout_1",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-10T00:00:00.000Z",
        created_at: "2026-07-02T00:00:00.000Z",
      },
    ])
    const incrementAmount = jest.fn().mockResolvedValue(undefined)
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(listPayouts).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending" })
    expect(linkSingleCommissionToPayout).toHaveBeenCalledWith("comm_new", "payout_1")
    expect(incrementAmount).toHaveBeenCalledWith("payout_1", 700)
  })

  it("does not link when no pending payout covers the commission's date", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = { id: "comm_new", created_at: "2026-07-15T00:00:00.000Z", sellerPayout: 700 }
    const recordAndCreate = jest.fn().mockResolvedValue(createdCommission)
    const linkSingleCommissionToPayout = jest.fn()
    const listPayouts = jest.fn().mockResolvedValue([
      {
        id: "payout_1",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-10T00:00:00.000Z",
        created_at: "2026-07-02T00:00:00.000Z",
      },
    ])
    const incrementAmount = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(linkSingleCommissionToPayout).not.toHaveBeenCalled()
    expect(incrementAmount).not.toHaveBeenCalled()
  })

  it("picks the earliest pending payout when more than one covers the commission's date", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = { id: "comm_new", created_at: "2026-07-05T00:00:00.000Z", sellerPayout: 700 }
    const recordAndCreate = jest.fn().mockResolvedValue(createdCommission)
    const linkSingleCommissionToPayout = jest.fn().mockResolvedValue(undefined)
    const listPayouts = jest.fn().mockResolvedValue([
      {
        id: "payout_newer",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-10T00:00:00.000Z",
        created_at: "2026-07-04T00:00:00.000Z",
      },
      {
        id: "payout_older",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-10T00:00:00.000Z",
        created_at: "2026-07-02T00:00:00.000Z",
      },
    ])
    const incrementAmount = jest.fn().mockResolvedValue(undefined)
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(linkSingleCommissionToPayout).toHaveBeenCalledWith("comm_new", "payout_older")
  })

  it("does not link when there is no pending payout for the seller", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = { id: "comm_new", created_at: "2026-07-05T00:00:00.000Z", sellerPayout: 700 }
    const recordAndCreate = jest.fn().mockResolvedValue(createdCommission)
    const linkSingleCommissionToPayout = jest.fn()
    const listPayouts = jest.fn().mockResolvedValue([])
    const incrementAmount = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(listPayouts).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending" })
    expect(linkSingleCommissionToPayout).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/subscribers/__tests__/commission-on-payment.unit.spec.ts --silent --runInBand --forceExit`
Expected: FAIL — o subscriber atual nunca resolve `PAYOUT_MODULE` nem chama `listPayouts`/`linkSingleCommissionToPayout`/`incrementAmount`.

- [ ] **Step 3: Modificar o subscriber**

Conteúdo atual de `packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts`:

```ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IOrderModuleService } from "@medusajs/framework/types"
import { COMMISSION_MODULE } from "../modules/commission"
import CommissionModuleService from "../modules/commission/service"

// Taxa de operação MercadoPago: 2,99% + R$0,39 por transação (estimativa)
function estimateBankingFees(grossAmount: number): number {
  return Math.round(grossAmount * 0.0299) + 39
}

export default async function commissionOnPayment({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id

  const orderService: IOrderModuleService = container.resolve(Modules.ORDER)
  const commissionService: CommissionModuleService = container.resolve(COMMISSION_MODULE)

  const order = await orderService.retrieveOrder(orderId, {
    relations: ["items"],
  })

  if (!order) return

  // sellerId vem do metadata do pedido (preenchido no checkout pelo storefront)
  const sellerId = (order.metadata?.seller_id as string) ?? "unknown"
  const grossAmount = Number(order.total ?? 0)
  const bankingFees = estimateBankingFees(grossAmount)

  const existing = await commissionService.listCommissions({ orderId })
  if (existing.length > 0) return  // idempotência

  await commissionService.recordAndCreate({
    orderId,
    sellerId,
    grossAmount,
    bankingFees,
  })
}

export const config: SubscriberConfig = {
  event: "order.payment_captured",
}
```

Substitua inteiramente por:

```ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IOrderModuleService } from "@medusajs/framework/types"
import { COMMISSION_MODULE } from "../modules/commission"
import { PAYOUT_MODULE } from "../modules/payout"
import CommissionModuleService from "../modules/commission/service"
import PayoutModuleService from "../modules/payout/service"

// Taxa de operação MercadoPago: 2,99% + R$0,39 por transação (estimativa)
function estimateBankingFees(grossAmount: number): number {
  return Math.round(grossAmount * 0.0299) + 39
}

export default async function commissionOnPayment({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id

  const orderService: IOrderModuleService = container.resolve(Modules.ORDER)
  const commissionService: CommissionModuleService = container.resolve(COMMISSION_MODULE)
  const payoutService: PayoutModuleService = container.resolve(PAYOUT_MODULE)

  const order = await orderService.retrieveOrder(orderId, {
    relations: ["items"],
  })

  if (!order) return

  // sellerId vem do metadata do pedido (preenchido no checkout pelo storefront)
  const sellerId = (order.metadata?.seller_id as string) ?? "unknown"
  const grossAmount = Number(order.total ?? 0)
  const bankingFees = estimateBankingFees(grossAmount)

  const existing = await commissionService.listCommissions({ orderId })
  if (existing.length > 0) return  // idempotência

  const commission = await commissionService.recordAndCreate({
    orderId,
    sellerId,
    grossAmount,
    bankingFees,
  })

  // Vínculo bidirecional: se já existe um payout pendente cobrindo esta comissão
  // (ex: pagamento confirmado com atraso, depois que o payout do período já foi
  // criado), vincula agora em vez de deixar a comissão órfã até um payout futuro.
  const pendingPayouts = await payoutService.listPayouts({ sellerId, status: "pending" })
  const created = new Date((commission as any).created_at)
  const covering = pendingPayouts
    .filter((p: any) => created >= new Date(p.periodStart) && created <= new Date(p.periodEnd))
    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  if (covering[0]) {
    await commissionService.linkSingleCommissionToPayout((commission as any).id, covering[0].id)
    await payoutService.incrementAmount(covering[0].id, Number((commission as any).sellerPayout))
  }
}

export const config: SubscriberConfig = {
  event: "order.payment_captured",
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/subscribers/__tests__/commission-on-payment.unit.spec.ts --silent --runInBand --forceExit`
Expected: PASS — 5/5 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/subscribers
git commit -m "feat(backend): link late-arriving commissions to a pending payout automatically"
```

---

### Task 9: Hooks do frontend (`src/admin/hooks/payouts.ts`)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/hooks/payouts.ts`
- Test: `packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/payouts.test.tsx` (novo)

**Interfaces:**
- Consumes: `sdk` de `../lib/sdk` (existente, do subsistema Vendedores).
- Produces (usado pelas Tasks 10 e 11):
  - `type Payout = { id: string; sellerId: string; sellerName: string; amount: number; periodStart: string; periodEnd: string; status: "pending" | "processing" | "completed" | "failed" | "cancelled"; processedAt: string | null; notes: string | null; created_at: string }`
  - `type PayoutPreview = { periodStart: string; periodEnd: string; amount: number; commissionCount: number }`
  - `type PayoutCommission = { id: string; orderId: string; grossAmount: number; commissionAmount: number; sellerPayout: number; status: "pending" | "paid"; created_at: string }`
  - `type PayoutSeller = { id: string; name: string; bankName: string | null; bankAgency: string | null; bankAccount: string | null; bankAccountType: "checking" | "savings" | null; pixKey: string | null; pixKeyType: "cpf" | "cnpj" | "email" | "phone" | "random" | null }`
  - `useAdminPayouts(filters: { seller_id?: string; status?: string; limit?: number; offset?: number }): UseQueryResult<{ payouts: Payout[]; total: number; count: number; limit: number; offset: number }>`
  - `useAdminPayout(id: string): UseQueryResult<{ payout: Payout; seller: PayoutSeller | null; commissions: PayoutCommission[] }>`
  - `useAdminPayoutPreview(sellerId: string, periodStart?: string, periodEnd?: string): UseQueryResult<PayoutPreview>`
  - `useCreatePayout()`, `useProcessPayout()`, `useCancelPayout()`

- [ ] **Step 1: Escrever o teste que falha**

Create `packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/payouts.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { sdk } from "../../lib/sdk"
import { useAdminPayouts, useAdminPayoutPreview, useCreatePayout } from "../payouts"

vi.mock("../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe("useAdminPayouts", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches /admin/payouts with the given filters", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      payouts: [], total: 0, count: 0, limit: 20, offset: 0,
    })

    const { result } = renderHook(
      () => useAdminPayouts({ status: "pending", limit: 20, offset: 0 }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
      query: { status: "pending", limit: 20, offset: 0 },
    })
  })
})

describe("useAdminPayoutPreview", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches with only seller_id when no period is given", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-06T00:00:00.000Z",
      amount: 0,
      commissionCount: 0,
    })

    const { result } = renderHook(() => useAdminPayoutPreview("seller_1"), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/preview", {
      query: { seller_id: "seller_1" },
    })
  })

  it("includes the explicit period in the query when given", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-06T00:00:00.000Z",
      amount: 500,
      commissionCount: 1,
    })

    const { result } = renderHook(
      () => useAdminPayoutPreview("seller_1", "2026-07-01T00:00:00.000Z", "2026-07-06T00:00:00.000Z"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/preview", {
      query: {
        seller_id: "seller_1",
        period_start: "2026-07-01T00:00:00.000Z",
        period_end: "2026-07-06T00:00:00.000Z",
      },
    })
  })

  it("does not fetch when sellerId is empty", () => {
    const { result } = renderHook(() => useAdminPayoutPreview(""), { wrapper })

    expect(result.current.fetchStatus).toBe("idle")
    expect(sdk.client.fetch).not.toHaveBeenCalled()
  })
})

describe("useCreatePayout", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("calls POST /admin/payouts with the given data", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ payout: { id: "payout_1" } })

    const { result } = renderHook(() => useCreatePayout(), { wrapper })
    result.current.mutate({
      sellerId: "seller_1",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-06T00:00:00.000Z",
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
      method: "POST",
      body: {
        sellerId: "seller_1",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-06T00:00:00.000Z",
      },
    })
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../payouts'`.

- [ ] **Step 3: Criar o arquivo de hooks**

Create `packages/medusa-backend/apps/backend/src/admin/hooks/payouts.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

export type Payout = {
  id: string
  sellerId: string
  sellerName: string
  amount: number
  periodStart: string
  periodEnd: string
  status: "pending" | "processing" | "completed" | "failed" | "cancelled"
  processedAt: string | null
  notes: string | null
  created_at: string
}

export type PayoutPreview = {
  periodStart: string
  periodEnd: string
  amount: number
  commissionCount: number
}

export type PayoutCommission = {
  id: string
  orderId: string
  grossAmount: number
  commissionAmount: number
  sellerPayout: number
  status: "pending" | "paid"
  created_at: string
}

export type PayoutSeller = {
  id: string
  name: string
  bankName: string | null
  bankAgency: string | null
  bankAccount: string | null
  bankAccountType: "checking" | "savings" | null
  pixKey: string | null
  pixKeyType: "cpf" | "cnpj" | "email" | "phone" | "random" | null
}

type PayoutsResponse = {
  payouts: Payout[]
  total: number
  count: number
  limit: number
  offset: number
}

type PayoutDetailResponse = {
  payout: Payout
  seller: PayoutSeller | null
  commissions: PayoutCommission[]
}

export function useAdminPayouts(
  filters: { seller_id?: string; status?: string; limit?: number; offset?: number } = {}
) {
  return useQuery({
    queryKey: ["admin-payouts", filters],
    queryFn: () => sdk.client.fetch<PayoutsResponse>("/admin/payouts", { query: filters }),
  })
}

export function useAdminPayout(id: string) {
  return useQuery({
    queryKey: ["admin-payout", id],
    queryFn: () => sdk.client.fetch<PayoutDetailResponse>(`/admin/payouts/${id}`),
    enabled: !!id,
  })
}

export function useAdminPayoutPreview(
  sellerId: string,
  periodStart?: string,
  periodEnd?: string
) {
  const query: Record<string, string> = { seller_id: sellerId }
  if (periodStart) query.period_start = periodStart
  if (periodEnd) query.period_end = periodEnd

  return useQuery({
    queryKey: ["admin-payout-preview", sellerId, periodStart, periodEnd],
    queryFn: () => sdk.client.fetch<PayoutPreview>("/admin/payouts/preview", { query }),
    enabled: !!sellerId,
  })
}

export function useCreatePayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { sellerId: string; periodStart: string; periodEnd: string; notes?: string }) =>
      sdk.client.fetch("/admin/payouts", { method: "POST", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] })
    },
  })
}

export function useProcessPayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sdk.client.fetch(`/admin/payouts/${id}/process`, { method: "POST" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] })
      queryClient.invalidateQueries({ queryKey: ["admin-payout", id] })
    },
  })
}

export function useCancelPayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sdk.client.fetch(`/admin/payouts/${id}/cancel`, { method: "POST" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] })
      queryClient.invalidateQueries({ queryKey: ["admin-payout", id] })
    },
  })
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 5 testes novos verdes, mais todos os testes admin anteriores continuando verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/admin/hooks/payouts.ts packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/payouts.test.tsx
git commit -m "feat(admin): add payouts hooks"
```

---

### Task 10: Lista (`/app/payouts`) + modal de criação

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/routes/payouts/page.tsx`
- Create: `packages/medusa-backend/apps/backend/src/admin/routes/payouts/create-payout-modal.tsx`
- Test: `packages/medusa-backend/apps/backend/src/admin/routes/payouts/__tests__/page.test.tsx` (novo)
- Test: `packages/medusa-backend/apps/backend/src/admin/routes/payouts/__tests__/create-payout-modal.test.tsx` (novo)

**Interfaces:**
- Consumes: `useAdminPayouts`, `type Payout` de `../../hooks/payouts` (Task 9); `useAdminSellers` de `../../hooks/sellers` (existente); `useAdminPayoutPreview`, `useCreatePayout` de `../../hooks/payouts` (Task 9); `defineRouteConfig` de `@medusajs/admin-sdk`.
- Produces: export default `PayoutsPage`, registrado na rota de sistema de arquivos `payouts` → `/app/payouts`, label na sidebar "Repasses". Export nomeado `CreatePayoutModal` de `create-payout-modal.tsx`, consumido por `page.tsx` e pela Task 11 (não diretamente, mas o padrão de navegação `/payouts/:id` é usado lá).

- [ ] **Step 1: Escrever o teste do modal que falha**

Create `packages/medusa-backend/apps/backend/src/admin/routes/payouts/__tests__/create-payout-modal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../lib/sdk"
import { CreatePayoutModal } from "../create-payout-modal"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CreatePayoutModal open={true} onOpenChange={() => {}} />
    </QueryClientProvider>
  )
}

describe("CreatePayoutModal", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("suggests the period and shows the calculated amount after selecting a seller", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") {
        return Promise.resolve({ sellers: [{ id: "seller_1", name: "Loja Teste" }], count: 1 })
      }
      return Promise.resolve({
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-06T00:00:00.000Z",
        amount: 8200,
        commissionCount: 2,
      })
    })
    const user = userEvent.setup()

    renderModal()
    await user.click(await screen.findByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Loja Teste" }))

    expect(await screen.findByText(/R\$ 82,00/)).toBeInTheDocument()
    expect(screen.getByLabelText("Início do período")).toHaveValue("2026-07-01")
    expect(screen.getByLabelText("Fim do período")).toHaveValue("2026-07-06")
  })

  it("disables the create button when the calculated amount is zero", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") {
        return Promise.resolve({ sellers: [{ id: "seller_1", name: "Loja Teste" }], count: 1 })
      }
      return Promise.resolve({
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-06T00:00:00.000Z",
        amount: 0,
        commissionCount: 0,
      })
    })
    const user = userEvent.setup()

    renderModal()
    await user.click(await screen.findByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Loja Teste" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Criar repasse" })).toBeDisabled())
  })

  it("submits with the selected seller and period on confirm", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") {
        return Promise.resolve({ sellers: [{ id: "seller_1", name: "Loja Teste" }], count: 1 })
      }
      if (path === "/admin/payouts/preview") {
        return Promise.resolve({
          periodStart: "2026-07-01T00:00:00.000Z",
          periodEnd: "2026-07-06T00:00:00.000Z",
          amount: 8200,
          commissionCount: 2,
        })
      }
      return Promise.resolve({ payout: { id: "payout_1" } })
    })
    const user = userEvent.setup()

    renderModal()
    await user.click(await screen.findByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Loja Teste" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Criar repasse" })).toBeEnabled())

    await user.click(screen.getByRole("button", { name: "Criar repasse" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
        method: "POST",
        body: {
          sellerId: "seller_1",
          periodStart: "2026-07-01T00:00:00.000Z",
          periodEnd: "2026-07-06T00:00:00.000Z",
        },
      })
    )
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../create-payout-modal'`.

- [ ] **Step 3: Criar o modal**

Create `packages/medusa-backend/apps/backend/src/admin/routes/payouts/create-payout-modal.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Button, FocusModal, Input, Label, Select, Text, toast } from "@medusajs/ui"
import { useAdminSellers } from "../../hooks/sellers"
import { useAdminPayoutPreview, useCreatePayout } from "../../hooks/payouts"

function toDateInputValue(iso: string) {
  return iso.slice(0, 10)
}

function toStartOfDayIso(dateInputValue: string) {
  return new Date(`${dateInputValue}T00:00:00.000Z`).toISOString()
}

export function CreatePayoutModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [sellerId, setSellerId] = useState("")
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")

  const { data: sellersData } = useAdminSellers({})
  const sellers = sellersData?.sellers ?? []

  const previewPeriodStart = periodStart ? toStartOfDayIso(periodStart) : undefined
  const previewPeriodEnd = periodEnd ? toStartOfDayIso(periodEnd) : undefined
  const { data: preview } = useAdminPayoutPreview(sellerId, previewPeriodStart, previewPeriodEnd)
  const createPayout = useCreatePayout()

  useEffect(() => {
    if (preview && !periodStart && !periodEnd) {
      setPeriodStart(toDateInputValue(preview.periodStart))
      setPeriodEnd(toDateInputValue(preview.periodEnd))
    }
  }, [preview, periodStart, periodEnd])

  const handleSellerChange = (value: string) => {
    setSellerId(value)
    setPeriodStart("")
    setPeriodEnd("")
  }

  const handleClose = () => {
    onOpenChange(false)
    setSellerId("")
    setPeriodStart("")
    setPeriodEnd("")
  }

  const handleConfirm = () => {
    createPayout.mutate(
      {
        sellerId,
        periodStart: toStartOfDayIso(periodStart),
        periodEnd: toStartOfDayIso(periodEnd),
      },
      {
        onSuccess: () => {
          toast.success("Repasse criado")
          handleClose()
        },
        onError: () => toast.error("Não foi possível criar o repasse"),
      }
    )
  }

  const amount = preview?.amount ?? 0
  const canSubmit = !!sellerId && !!periodStart && !!periodEnd && amount > 0

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" disabled={!canSubmit} onClick={handleConfirm}>
            Criar repasse
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 p-6">
          <div>
            <Select value={sellerId} onValueChange={handleSellerChange}>
              <Select.Trigger>
                <Select.Value placeholder="Selecione o vendedor" />
              </Select.Trigger>
              <Select.Content>
                {sellers.map((seller) => (
                  <Select.Item key={seller.id} value={seller.id}>
                    {seller.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex gap-4">
            <div>
              <Label htmlFor="payout-period-start">Início do período</Label>
              <Input
                id="payout-period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="payout-period-end">Fim do período</Label>
              <Input
                id="payout-period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>
          {sellerId && periodStart && periodEnd && (
            <Text>
              Valor calculado: {(amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              {amount <= 0 && " — nenhuma comissão pendente neste período."}
            </Text>
          )}
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
```

- [ ] **Step 4: Rodar o teste do modal e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 3/3 testes do modal verdes.

- [ ] **Step 5: Escrever o teste da lista que falha**

Create `packages/medusa-backend/apps/backend/src/admin/routes/payouts/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../lib/sdk"
import PayoutsPage from "../page"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const emptySellers = { sellers: [], count: 0 }
const emptyPayouts = { payouts: [], total: 0, count: 0, limit: 20, offset: 0 }

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PayoutsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("PayoutsPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches payouts filtered by pending status on first render", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyPayouts)
    })

    renderPage()

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
        query: { limit: 20, offset: 0, status: "pending" },
      })
    )
  })

  it("shows the empty state when there are no payouts", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyPayouts)
    })

    renderPage()

    expect(await screen.findByText("Nenhum repasse encontrado.")).toBeInTheDocument()
  })

  it("shows an error message when the fetch fails", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.reject(new Error("network error"))
    })

    renderPage()

    expect(
      await screen.findByText("Não foi possível carregar os repasses. Tente novamente.")
    ).toBeInTheDocument()
  })

  it("renders a row per payout with seller name, amount, period, and status", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve({
        payouts: [
          {
            id: "payout_1",
            sellerId: "seller_1",
            sellerName: "Mulheres de Axé do Brasil",
            amount: 8200,
            periodStart: "2026-07-01T00:00:00.000Z",
            periodEnd: "2026-07-06T00:00:00.000Z",
            status: "pending",
            processedAt: null,
            notes: null,
            created_at: "2026-07-06T00:00:00.000Z",
          },
        ],
        total: 8200,
        count: 1,
        limit: 20,
        offset: 0,
      })
    })

    renderPage()

    expect(await screen.findByText("Mulheres de Axé do Brasil")).toBeInTheDocument()
    expect(screen.getByText("R$ 82,00")).toBeInTheDocument()
    expect(screen.getByText("Pendente")).toBeInTheDocument()
  })

  it("opens the create payout modal when the button is clicked", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyPayouts)
    })
    const user = userEvent.setup()

    renderPage()
    await screen.findByText("Nenhum repasse encontrado.")
    await user.click(screen.getByRole("button", { name: "+ Novo repasse" }))

    expect(await screen.findByRole("button", { name: "Criar repasse" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../page'`.

- [ ] **Step 7: Criar a página de lista**

Create `packages/medusa-backend/apps/backend/src/admin/routes/payouts/page.tsx`:

```tsx
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowUpDown } from "@medusajs/icons"
import { Button, Container, Heading, Select, StatusBadge, Table, Text } from "@medusajs/ui"
import { useAdminPayouts, type Payout } from "../../hooks/payouts"
import { useAdminSellers } from "../../hooks/sellers"
import { CreatePayoutModal } from "./create-payout-modal"

const PAGE_SIZE = 20
const ALL_SELLERS = "all"
const ALL_STATUSES = "all"

const STATUS_LABELS: Record<Payout["status"], string> = {
  pending: "Pendente",
  processing: "Processando",
  completed: "Pago",
  failed: "Falhou",
  cancelled: "Cancelado",
}

const STATUS_COLORS: Record<Payout["status"], "orange" | "blue" | "green" | "red" | "grey"> = {
  pending: "orange",
  processing: "blue",
  completed: "green",
  failed: "red",
  cancelled: "grey",
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("pt-BR")
}

function TotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-lg border border-ui-border-base p-4">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="xlarge" weight="plus">
        {value}
      </Text>
    </div>
  )
}

function PayoutsPage() {
  const [sellerId, setSellerId] = useState(ALL_SELLERS)
  const [status, setStatus] = useState("pending")
  const [pageIndex, setPageIndex] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  const { data: sellersData } = useAdminSellers({})
  const sellers = sellersData?.sellers ?? []

  const filters: { seller_id?: string; status?: string; limit: number; offset: number } = {
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  }
  if (sellerId !== ALL_SELLERS) filters.seller_id = sellerId
  if (status !== ALL_STATUSES) filters.status = status

  const { data, isLoading, isError } = useAdminPayouts(filters)
  const payouts = data?.payouts ?? []
  const total = data?.total ?? 0
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Repasses</Heading>
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
            <Select.Trigger className="w-44">
              <Select.Value placeholder="Status" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={ALL_STATUSES}>Todos</Select.Item>
              <Select.Item value="pending">Pendente</Select.Item>
              <Select.Item value="completed">Pago</Select.Item>
              <Select.Item value="cancelled">Cancelado</Select.Item>
            </Select.Content>
          </Select>
          <Button size="small" onClick={() => setCreateOpen(true)}>
            + Novo repasse
          </Button>
        </div>
      </div>

      <div className="flex gap-4 px-6 pb-4">
        <TotalCard label="Valor total (filtro atual)" value={formatBRL(total)} />
        <TotalCard label="Quantidade de repasses" value={String(count)} />
      </div>

      {isError && (
        <div className="px-6 py-8 text-center">
          <Text>Não foi possível carregar os repasses. Tente novamente.</Text>
        </div>
      )}

      {!isError && !isLoading && payouts.length === 0 && (
        <div className="px-6 py-8 text-center">
          <Text>Nenhum repasse encontrado.</Text>
        </div>
      )}

      {payouts.length > 0 && (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Vendedor</Table.HeaderCell>
                <Table.HeaderCell>Valor</Table.HeaderCell>
                <Table.HeaderCell>Período</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {payouts.map((payout) => (
                <Table.Row
                  key={payout.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/payouts/${payout.id}`)}
                >
                  <Table.Cell>{payout.sellerName}</Table.Cell>
                  <Table.Cell>{formatBRL(payout.amount)}</Table.Cell>
                  <Table.Cell>
                    {formatDate(payout.periodStart)} – {formatDate(payout.periodEnd)}
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={STATUS_COLORS[payout.status]}>
                      {STATUS_LABELS[payout.status]}
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

      <CreatePayoutModal open={createOpen} onOpenChange={setCreateOpen} />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Repasses",
  icon: ArrowUpDown,
})

export default PayoutsPage
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 5/5 testes da lista verdes, mais os 3 do modal, mais todos os testes admin anteriores.

- [ ] **Step 9: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/admin/routes/payouts/page.tsx packages/medusa-backend/apps/backend/src/admin/routes/payouts/create-payout-modal.tsx packages/medusa-backend/apps/backend/src/admin/routes/payouts/__tests__
git commit -m "feat(admin): add payouts list route with create modal"
```

---

### Task 11: Detalhe (`/app/payouts/:id`)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/routes/payouts/[id]/page.tsx`
- Test: `packages/medusa-backend/apps/backend/src/admin/routes/payouts/[id]/__tests__/page.test.tsx` (novo)

**Interfaces:**
- Consumes: `useAdminPayout`, `useProcessPayout`, `useCancelPayout`, `type Payout` de `../../../hooks/payouts` (Task 9).
- Produces: export default `PayoutDetailPage`, registrado na rota `/app/payouts/:id`.

- [ ] **Step 1: Escrever o teste que falha**

Create `packages/medusa-backend/apps/backend/src/admin/routes/payouts/[id]/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../../lib/sdk"
import PayoutDetailPage from "../page"

vi.mock("../../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const basePayout = {
  id: "payout_1",
  sellerId: "seller_1",
  sellerName: "Mulheres de Axé do Brasil",
  amount: 8200,
  periodStart: "2026-07-01T00:00:00.000Z",
  periodEnd: "2026-07-06T00:00:00.000Z",
  status: "pending",
  processedAt: null,
  notes: null,
  created_at: "2026-07-06T00:00:00.000Z",
}

const baseSeller = {
  id: "seller_1",
  name: "Mulheres de Axé do Brasil",
  bankName: "Banco do Brasil",
  bankAgency: "1234",
  bankAccount: "56789-0",
  bankAccountType: "checking",
  pixKey: "contato@mercadopreto.com.br",
  pixKeyType: "email",
}

function renderDetail(initialPath = "/payouts/payout_1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/payouts/:id" element={<PayoutDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("PayoutDetailPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("shows the seller's banking data and linked commissions for a pending payout", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      payout: basePayout,
      seller: baseSeller,
      commissions: [
        {
          id: "comm_1",
          orderId: "order_1",
          grossAmount: 10000,
          commissionAmount: 1500,
          sellerPayout: 8200,
          status: "pending",
          created_at: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    renderDetail()

    expect(await screen.findByText("Banco do Brasil")).toBeInTheDocument()
    expect(screen.getByText("contato@mercadopreto.com.br")).toBeInTheDocument()
    expect(screen.getByText("order_1")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Processar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument()
  })

  it("hides action buttons for a completed payout", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      payout: { ...basePayout, status: "completed", processedAt: "2026-07-07T00:00:00.000Z" },
      seller: baseSeller,
      commissions: [],
    })

    renderDetail()

    await screen.findByText("Banco do Brasil")
    expect(screen.queryByRole("button", { name: "Processar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument()
  })

  it("calls the process mutation when confirmed", async () => {
    vi.mocked(sdk.client.fetch)
      .mockResolvedValueOnce({ payout: basePayout, seller: baseSeller, commissions: [] })
      .mockResolvedValueOnce({ payout: { ...basePayout, status: "completed" } })
      .mockResolvedValue({ payout: { ...basePayout, status: "completed" }, seller: baseSeller, commissions: [] })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Processar" }))
    await user.click(await screen.findByRole("button", { name: "Já fiz a transferência" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/payout_1/process", { method: "POST" })
    )
  })

  it("calls the cancel mutation when confirmed", async () => {
    vi.mocked(sdk.client.fetch)
      .mockResolvedValueOnce({ payout: basePayout, seller: baseSeller, commissions: [] })
      .mockResolvedValueOnce({ payout: { ...basePayout, status: "cancelled" } })
      .mockResolvedValue({ payout: { ...basePayout, status: "cancelled" }, seller: baseSeller, commissions: [] })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Cancelar" }))
    await user.click(await screen.findByRole("button", { name: "Confirmar cancelamento" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/payout_1/cancel", { method: "POST" })
    )
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../page'`.

- [ ] **Step 3: Criar a página de detalhe**

Create `packages/medusa-backend/apps/backend/src/admin/routes/payouts/[id]/page.tsx`:

```tsx
import { useState } from "react"
import { useParams } from "react-router-dom"
import {
  Button,
  Container,
  Heading,
  Prompt,
  StatusBadge,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import {
  useAdminPayout,
  useProcessPayout,
  useCancelPayout,
  type Payout,
} from "../../../hooks/payouts"

const STATUS_LABELS: Record<Payout["status"], string> = {
  pending: "Pendente",
  processing: "Processando",
  completed: "Pago",
  failed: "Falhou",
  cancelled: "Cancelado",
}

const STATUS_COLORS: Record<Payout["status"], "orange" | "blue" | "green" | "red" | "grey"> = {
  pending: "orange",
  processing: "blue",
  completed: "green",
  failed: "red",
  cancelled: "grey",
}

const PIX_KEY_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Aleatória",
}

const BANK_ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("pt-BR")
}

function ProfileField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text>{value || "—"}</Text>
    </div>
  )
}

function ProcessDialog({ payoutId }: { payoutId: string }) {
  const [open, setOpen] = useState(false)
  const processPayout = useProcessPayout()

  const handleConfirm = () => {
    processPayout.mutate(payoutId, {
      onSuccess: () => {
        toast.success("Repasse processado")
        setOpen(false)
      },
      onError: () => toast.error("Não foi possível processar o repasse"),
    })
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button size="small">Processar</Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Processar repasse</Prompt.Title>
          <Prompt.Description>
            Confirme que a transferência bancária/PIX já foi feita para o vendedor antes de continuar.
          </Prompt.Description>
        </Prompt.Header>
        <Prompt.Footer>
          <Prompt.Cancel>Cancelar</Prompt.Cancel>
          <Button onClick={handleConfirm}>Já fiz a transferência</Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function CancelDialog({ payoutId }: { payoutId: string }) {
  const [open, setOpen] = useState(false)
  const cancelPayout = useCancelPayout()

  const handleConfirm = () => {
    cancelPayout.mutate(payoutId, {
      onSuccess: () => {
        toast.success("Repasse cancelado")
        setOpen(false)
      },
      onError: () => toast.error("Não foi possível cancelar o repasse"),
    })
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button variant="danger" size="small">
          Cancelar
        </Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Cancelar repasse</Prompt.Title>
          <Prompt.Description>
            As comissões vinculadas voltam a ficar pendentes, livres para um repasse futuro.
          </Prompt.Description>
        </Prompt.Header>
        <Prompt.Footer>
          <Prompt.Cancel>Voltar</Prompt.Cancel>
          <Button variant="danger" onClick={handleConfirm}>
            Confirmar cancelamento
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function PayoutDetailPage() {
  const { id } = useParams()
  const { data } = useAdminPayout(id ?? "")

  const payout = data?.payout
  const seller = data?.seller
  const commissions = data?.commissions ?? []

  if (!payout) {
    return null
  }

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">{payout.sellerName}</Heading>
          <StatusBadge color={STATUS_COLORS[payout.status]}>
            {STATUS_LABELS[payout.status]}
          </StatusBadge>
        </div>
        {payout.status === "pending" && (
          <div className="flex gap-2">
            <ProcessDialog payoutId={payout.id} />
            <CancelDialog payoutId={payout.id} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 px-6 pb-6">
        <ProfileField label="Valor" value={formatBRL(payout.amount)} />
        <ProfileField
          label="Período"
          value={`${formatDate(payout.periodStart)} – ${formatDate(payout.periodEnd)}`}
        />
        <ProfileField label="Notas" value={payout.notes} />
        <ProfileField
          label="Processado em"
          value={payout.processedAt ? formatDate(payout.processedAt) : null}
        />
      </div>

      {seller && (
        <div className="border-t border-ui-border-base px-6 py-6">
          <Text weight="plus" className="mb-4">
            Dados bancários / PIX
          </Text>
          <div className="grid grid-cols-2 gap-4">
            <ProfileField label="Banco" value={seller.bankName} />
            <ProfileField label="Agência" value={seller.bankAgency} />
            <ProfileField label="Conta" value={seller.bankAccount} />
            <ProfileField
              label="Tipo de conta"
              value={seller.bankAccountType ? BANK_ACCOUNT_TYPE_LABELS[seller.bankAccountType] : null}
            />
            <ProfileField label="Chave PIX" value={seller.pixKey} />
            <ProfileField
              label="Tipo de chave PIX"
              value={seller.pixKeyType ? PIX_KEY_TYPE_LABELS[seller.pixKeyType] : null}
            />
          </div>
        </div>
      )}

      <div className="border-t border-ui-border-base px-6 py-6">
        <Text weight="plus" className="mb-4">
          Comissões vinculadas
        </Text>
        {commissions.length === 0 ? (
          <Text className="text-ui-fg-subtle">Nenhuma comissão vinculada.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Pedido</Table.HeaderCell>
                <Table.HeaderCell>Valor bruto</Table.HeaderCell>
                <Table.HeaderCell>Repasse</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {commissions.map((commission) => (
                <Table.Row key={commission.id}>
                  <Table.Cell>{commission.orderId}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.grossAmount)}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.sellerPayout)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export default PayoutDetailPage
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 4/4 testes da página de detalhe verdes, mais todos os testes admin anteriores.

- [ ] **Step 5: Commit**

```bash
git add "packages/medusa-backend/apps/backend/src/admin/routes/payouts/[id]"
git commit -m "feat(admin): add payout detail page with process/cancel dialogs"
```

---

### Task 12: Verificação final

**Files:** nenhum (só verificação).

**Interfaces:** nenhuma.

- [ ] **Step 1: Rodar a suíte completa do Jest (backend)**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit`
Expected: PASS — todos os testes existentes mais os novos desta plan (2 de PayoutModuleService + 5 de CommissionModuleService + 3 de GET payouts + 4 de POST payouts + 5 de preview + 3 de detalhe + 3 de cancel + 5 do subscriber = 30 novos).

- [ ] **Step 2: Rodar a suíte completa do Vitest (admin)**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — todos os testes anteriores mais os novos desta plan (5 de hooks + 3 do modal + 5 da lista + 4 do detalhe = 17 novos).

- [ ] **Step 3: Typecheck do backend**

Run: `cd packages/medusa-backend/apps/backend && npx tsc --noEmit`
Expected: nenhum erro novo atribuível a arquivos tocados nesta plan. (O erro pré-existente e não relacionado em `src/scripts/nuvemshop-import/__tests__/client.unit.spec.ts` continua aparecendo — esperado, fora de escopo, já documentado nas revisões finais dos planos de Vendedores e Comissões.)

- [ ] **Step 4: Build da extensão de admin**

Run: `cd packages/medusa-backend/apps/backend && npx medusa build`
Expected: build bem-sucedido, sem erros.

- [ ] **Step 5: Teste manual no navegador**

Suba o servidor local (`npx medusa start` a partir de `packages/medusa-backend/apps/backend`, com Postgres/Redis/Meilisearch locais rodando — mesmo setup usado nas verificações finais de Vendedores e Comissões), depois no navegador:

1. Login em `/app` como admin.
2. Confirme que "Repasses" aparece na sidebar, abaixo de "Comissões".
3. Abra a tela — confirme que carrega com filtro "Pendente" pré-selecionado.
4. Clique em "+ Novo repasse", selecione um vendedor com comissões pendentes reais — confirme que o período é sugerido automaticamente e o valor calculado aparece.
5. Tente escolher um período cujo fim seja mais recente que 5 dias atrás — confirme que a criação é bloqueada com mensagem clara (teste tanto via UI quanto via `curl` direto em `POST /admin/payouts` para confirmar o erro 400 da janela de maturação).
6. Crie um repasse válido (período maturado, vendedor com comissões pendentes) — confirme que aparece na lista com status "Pendente" e que as comissões correspondentes na tela de Comissões agora mostram `payoutId` setado (via query direta no banco, se necessário) mas continuam "Pendente" (só ficam "Pago" ao processar).
7. Abra o detalhe do repasse criado — confirme que os dados bancários/PIX do vendedor aparecem corretamente e a lista de comissões vinculadas está correta.
8. Clique em "Processar", confirme no dialog — confirme que o status muda para "Pago" e que as comissões vinculadas na tela de Comissões agora mostram "Pago".
9. Crie um segundo repasse para outro vendedor, e cancele-o pelo botão "Cancelar" — confirme que o status vira "Cancelado" e que as comissões que estavam vinculadas a ele voltam a aparecer como "Pendente" sem `payoutId` na tela de Comissões.
10. **Verificação do vínculo bidirecional (ponta a ponta):** crie um repasse pendente para um vendedor (sem processá-lo ainda). Insira diretamente no banco uma nova `Commission` `pending` para esse mesmo vendedor, com `created_at` dentro do período do repasse pendente (simulando um pagamento confirmado com atraso). Dispare o subscriber manualmente ou aguarde o próximo evento real de `order.payment_captured` — confirme que a nova comissão aparece automaticamente vinculada ao repasse pendente (via query no banco: `payoutId` setado) e que o `amount` do repasse foi incrementado. Processe o repasse e confirme que essa comissão tardia também vira "Pago".

Expected: todos os passos funcionam sem erros no console, consistente com o comportamento verificado nos testes automatizados.

- [ ] **Step 6: Commit se algum ajuste foi necessário**

Se os steps 1–5 não exigiram nenhuma mudança de código, não há nada para commitar — esta task é só verificação. Se algum ajuste foi necessário, commite com uma mensagem `fix(admin): ...` ou `fix(backend): ...` apropriada antes de prosseguir.
