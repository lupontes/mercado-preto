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
