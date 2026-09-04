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
  created_at: "2026-07-05T00:00:00.000Z",
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

  it("requests total/metadata/created_at in select — select is a whitelist, so any field read from order.* must be listed or comes back undefined", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions: jest.fn().mockResolvedValue([{ id: "comm_existing" }]), recordAndCreate: jest.fn() },
      payout: { listPayouts: jest.fn() },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(retrieveOrder).toHaveBeenCalledWith(
      "order_1",
      expect.objectContaining({
        select: expect.arrayContaining(["total", "metadata", "created_at"]),
      })
    )
  })

  it("links the new commission to a pending payout covering its period, and increments the payout amount", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = {
      id: "comm_new",
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

  it("does not link when no pending payout covers the order's date", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue({
      ...baseOrder,
      created_at: "2026-07-15T00:00:00.000Z",
    })
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = { id: "comm_new", sellerPayout: 700 }
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

  it("picks the earliest pending payout when more than one covers the order's date", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = { id: "comm_new", sellerPayout: 700 }
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
    const createdCommission = { id: "comm_new", sellerPayout: 700 }
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

  it("computes bankingFees from the Mercado Livre sale fee (stored on the listing) when the order's channel is mercado_livre, instead of the MercadoPago fee formula", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue({
      ...baseOrder,
      metadata: { seller_id: "seller_1", channel: "mercado_livre", mercadolivre_item_id: "MLB999" },
    })
    const channelService = {
      findListingByExternalItemId: jest.fn().mockResolvedValue({ saleFeePercent: 12.5, saleFeeFixed: 500 }),
    }
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
      marketplace_channel: channelService,
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    // baseOrder.total = 10000; 10000 * 12.5% = 1250 (arredondado) + 500 fixo = 1750
    expect(channelService.findListingByExternalItemId).toHaveBeenCalledWith("MLB999")
    expect(recordAndCreate).toHaveBeenCalledWith(
      expect.objectContaining({ grossAmount: 10000, bankingFees: 1750 })
    )
  })

  it("treats a mercado_livre order with no resolvable listing as zero sale fee, instead of failing", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue({
      ...baseOrder,
      metadata: { seller_id: "seller_1", channel: "mercado_livre", mercadolivre_item_id: "MLB999" },
    })
    const channelService = { findListingByExternalItemId: jest.fn().mockResolvedValue(null) }
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
      marketplace_channel: channelService,
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(recordAndCreate).toHaveBeenCalledWith(expect.objectContaining({ bankingFees: 0 }))
  })
})
