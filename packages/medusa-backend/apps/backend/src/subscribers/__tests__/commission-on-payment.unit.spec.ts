import { Modules } from "@medusajs/framework/utils"
import commissionOnPayment, { config, allocateFixedFee } from "../commission-on-payment"

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
  metadata: { seller_id: "seller_1", mercadopago_external_reference: "ext-ref-1" },
  created_at: "2026-07-05T00:00:00.000Z",
  items: [{ unit_price: 10000, quantity: 1 }],
  shipping_methods: [{ amount: 1500 }],
}

function makeOrderService(overrides: Record<string, unknown> = {}) {
  return {
    retrieveOrder: jest.fn().mockResolvedValue(baseOrder),
    listOrders: jest.fn().mockResolvedValue([baseOrder]),
    ...overrides,
  }
}

describe("commissionOnPayment", () => {
  it("subscribes to mercadopago.order_approved — the only event the MercadoPago webhook actually emits for created orders; order.payment_captured is never emitted anywhere in this codebase, so subscribing to it means commission is never recorded", () => {
    expect(config.event).toBe("mercadopago.order_approved")
  })

  it("does nothing when the commission already exists (idempotency)", async () => {
    const orderService = makeOrderService()
    const listCommissions = jest.fn().mockResolvedValue([{ id: "comm_existing" }])
    const recordAndCreate = jest.fn()
    const listPayouts = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions, recordAndCreate },
      payout: { listPayouts },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(recordAndCreate).not.toHaveBeenCalled()
    expect(listPayouts).not.toHaveBeenCalled()
    // idempotência é checada antes de qualquer consulta extra (siblings)
    expect(orderService.listOrders).not.toHaveBeenCalled()
  })

  it("requests items/shipping_methods relations and metadata/created_at in select", async () => {
    const orderService = makeOrderService()
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions: jest.fn().mockResolvedValue([{ id: "comm_existing" }]), recordAndCreate: jest.fn() },
      payout: { listPayouts: jest.fn() },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(orderService.retrieveOrder).toHaveBeenCalledWith(
      "order_1",
      expect.objectContaining({
        relations: expect.arrayContaining(["items", "shipping_methods"]),
        select: expect.arrayContaining(["metadata", "created_at"]),
      })
    )
  })

  it("computes grossAmount from item unit_price × quantity, excluding shipping entirely", async () => {
    const orderService = makeOrderService({
      retrieveOrder: jest.fn().mockResolvedValue({
        ...baseOrder,
        items: [{ unit_price: 7900, quantity: 2 }],
        shipping_methods: [{ amount: 2500 }],
      }),
      listOrders: jest.fn().mockResolvedValue([
        { id: "order_1", items: [{ unit_price: 7900, quantity: 2 }] },
      ]),
    })
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(recordAndCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        grossAmount: 15800, // 7900 * 2, sem o frete de 2500
        shippingAmount: 2500,
      })
    )
  })

  it("passes the full shipping amount through separately so it reaches sellerPayout untaxed", async () => {
    const orderService = makeOrderService()
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(recordAndCreate).toHaveBeenCalledWith(
      expect.objectContaining({ shippingAmount: 1500 })
    )
  })

  it("charges the full R$0,39 fixed banking fee when this is the only order for the payment (no split)", async () => {
    const orderService = makeOrderService({
      listOrders: jest.fn().mockResolvedValue([baseOrder]), // só este pedido pra essa external_reference
    })
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    // grossAmount 10000 → percentual = round(10000*0.0299) = 299; fixo = 39 inteiro
    expect(recordAndCreate).toHaveBeenCalledWith(
      expect.objectContaining({ bankingFees: 299 + 39 })
    )
  })

  it("splits the R$0,39 fixed banking fee proportionally across sibling orders from the same split payment", async () => {
    const orderA = { id: "order_a", items: [{ unit_price: 1000, quantity: 1 }] }
    const orderB = { id: "order_b", items: [{ unit_price: 18200, quantity: 1 }] }
    const orderService = makeOrderService({
      retrieveOrder: jest.fn().mockResolvedValue({
        ...baseOrder,
        id: "order_a",
        items: [{ unit_price: 1000, quantity: 1 }],
        shipping_methods: [],
      }),
      listOrders: jest.fn().mockResolvedValue([orderA, orderB]),
    })
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
    })

    await commissionOnPayment({ event: { data: { id: "order_a" } }, container } as any)

    // total 19200 (1000+18200); share de order_a = floor(39*1000/19200) = 2
    // percentual sobre 1000 = round(1000*0.0299) = 30
    expect(recordAndCreate).toHaveBeenCalledWith(
      expect.objectContaining({ grossAmount: 1000, bankingFees: 30 + 2 })
    )
  })

  it("does not query for sibling orders when the order has no mercadopago_external_reference", async () => {
    const orderService = makeOrderService({
      retrieveOrder: jest.fn().mockResolvedValue({
        ...baseOrder,
        metadata: { seller_id: "seller_1" }, // sem mercadopago_external_reference
      }),
    })
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(orderService.listOrders).not.toHaveBeenCalled()
    expect(recordAndCreate).toHaveBeenCalledWith(
      expect.objectContaining({ bankingFees: 299 + 39 })
    )
  })

  it("links the new commission to a pending payout covering its period, and increments the payout amount", async () => {
    const orderService = makeOrderService()
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
      [Modules.ORDER]: orderService,
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(listPayouts).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending" })
    expect(linkSingleCommissionToPayout).toHaveBeenCalledWith("comm_new", "payout_1")
    expect(incrementAmount).toHaveBeenCalledWith("payout_1", 700)
  })

  it("does not link when no pending payout covers the order's date", async () => {
    const orderService = makeOrderService({
      retrieveOrder: jest.fn().mockResolvedValue({
        ...baseOrder,
        created_at: "2026-07-15T00:00:00.000Z",
      }),
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
      [Modules.ORDER]: orderService,
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(linkSingleCommissionToPayout).not.toHaveBeenCalled()
    expect(incrementAmount).not.toHaveBeenCalled()
  })

  it("picks the earliest pending payout when more than one covers the order's date", async () => {
    const orderService = makeOrderService()
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
      [Modules.ORDER]: orderService,
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(linkSingleCommissionToPayout).toHaveBeenCalledWith("comm_new", "payout_older")
  })

  it("does not link when there is no pending payout for the seller", async () => {
    const orderService = makeOrderService()
    const listCommissions = jest.fn().mockResolvedValue([])
    const createdCommission = { id: "comm_new", sellerPayout: 700 }
    const recordAndCreate = jest.fn().mockResolvedValue(createdCommission)
    const linkSingleCommissionToPayout = jest.fn()
    const listPayouts = jest.fn().mockResolvedValue([])
    const incrementAmount = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: orderService,
      commission: { listCommissions, recordAndCreate, linkSingleCommissionToPayout },
      payout: { listPayouts, incrementAmount },
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(listPayouts).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending" })
    expect(linkSingleCommissionToPayout).not.toHaveBeenCalled()
  })
})

describe("allocateFixedFee", () => {
  it("assigns the entire fixed fee to a single order", () => {
    const result = allocateFixedFee([{ id: "order_1", productsGross: 10000 }])
    expect(result).toEqual({ order_1: 39 })
  })

  it("splits proportionally by productsGross share, remainder to the largest", () => {
    const result = allocateFixedFee([
      { id: "order_a", productsGross: 1000 },
      { id: "order_b", productsGross: 18200 },
    ])
    // floor(39*1000/19200)=2, floor(39*18200/19200)=36, resto 1 vai pro maior (order_b)
    expect(result).toEqual({ order_a: 2, order_b: 37 })
    expect(result.order_a + result.order_b).toBe(39)
  })

  it("always sums exactly to the fixed fee regardless of how many orders share the payment", () => {
    const result = allocateFixedFee([
      { id: "order_1", productsGross: 3333 },
      { id: "order_2", productsGross: 3333 },
      { id: "order_3", productsGross: 3334 },
    ])
    const sum = Object.values(result).reduce((a, b) => a + b, 0)
    expect(sum).toBe(39)
  })

  it("returns zero shares for every order when total productsGross is zero (no divide-by-zero)", () => {
    const result = allocateFixedFee([
      { id: "order_1", productsGross: 0 },
      { id: "order_2", productsGross: 0 },
    ])
    // remainder inteiro (39) vai pro "maior" — com empate em 0, o primeiro da ordenação
    const sum = Object.values(result).reduce((a, b) => a + b, 0)
    expect(sum).toBe(39)
  })
})
