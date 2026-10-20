import { Modules } from "@medusajs/framework/utils"
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

describe("GET /seller/orders", () => {
  it("requests status, created_at and display_id in select — otherwise Medusa returns them undefined (the same select-whitelist quirk documented in commission-on-payment.ts and order-fiscal-emit.ts), leaving the panel's Status/Data columns blank", async () => {
    const listOrders = jest.fn().mockResolvedValue([])
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [Modules.ORDER]: { listOrders } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { seller_id: "seller_1" } }),
      expect.objectContaining({
        select: expect.arrayContaining(["status", "created_at", "display_id"]),
        relations: expect.arrayContaining(["items", "shipping_methods"]),
      })
    )
  })

  it("does not request the decorated 'total' field — Medusa's list query crashes computing shipping adjustments for orders created outside the full cart/checkout workflow (500: \"Shipping method version is required to load adjustments\"), confirmed against this project's own orders (created via orderService.createOrders() in the MercadoPago webhook)", async () => {
    const listOrders = jest.fn().mockResolvedValue([])
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [Modules.ORDER]: { listOrders } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    const [, config] = listOrders.mock.calls[0]
    expect(config.select).not.toContain("total")
  })

  it("computes each order's total from its own items + shipping methods, instead of relying on Medusa's decorated total", async () => {
    const listOrders = jest.fn().mockResolvedValue([
      {
        id: "order_1",
        items: [
          { unit_price: 7900, quantity: 1 },
          { unit_price: 500, quantity: 2 },
        ],
        shipping_methods: [{ amount: 1500 }],
      },
    ])
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [Modules.ORDER]: { listOrders } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    // 7900 + (500*2) + 1500 = 10400
    expect((res._body as any).orders[0].total).toBe(10400)
  })

  it("returns total 0 for an order with no items and no shipping methods, without throwing", async () => {
    const listOrders = jest.fn().mockResolvedValue([{ id: "order_1", items: [], shipping_methods: [] }])
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [Modules.ORDER]: { listOrders } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect((res._body as any).orders[0].total).toBe(0)
  })

  it("returns the orders scoped to the seller, with pagination metadata", async () => {
    const orders = [
      { id: "order_1", items: [], shipping_methods: [] },
      { id: "order_2", items: [], shipping_methods: [] },
    ]
    const listOrders = jest.fn().mockResolvedValue(orders)
    const req = {
      sellerId: "seller_1",
      query: { limit: "10", offset: "5" },
      scope: makeScope({ [Modules.ORDER]: { listOrders } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect((res._body as any).count).toBe(2)
    expect((res._body as any).limit).toBe(10)
    expect((res._body as any).offset).toBe(5)
  })

  it("returns each order's shipping_status, without exposing the rest of its metadata (it holds the buyer's CPF)", async () => {
    const listOrders = jest.fn().mockResolvedValue([
      {
        id: "order_1",
        items: [],
        shipping_methods: [],
        metadata: { seller_id: "seller_1", buyer_document: "11144477735", shipping_status: "awaiting_shipment" },
      },
      { id: "order_legacy", items: [], shipping_methods: [], metadata: { seller_id: "seller_1" } },
    ])
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [Modules.ORDER]: { listOrders } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    const [, config] = listOrders.mock.calls[0]
    expect(config.select).toContain("metadata")
    const [order, legacy] = (res._body as any).orders
    expect(order.shipping_status).toBe("awaiting_shipment")
    expect(order.metadata).toBeUndefined()
    expect(legacy.shipping_status).toBeNull()
  })

  it("exposes only status, tracking_code and post_by of the label, never the buyer document", async () => {
    const listOrders = jest.fn().mockResolvedValue([
      {
        id: "order_1", items: [], shipping_methods: [],
        metadata: {
          buyer_document: "12345678900",
          shipping_label: { status: "generated", trackingCode: "BR1", postBy: "2026-10-25T00:00:00Z", meOrderIds: ["me1"], error: "x" },
        },
      },
      { id: "order_2", items: [], shipping_methods: [], metadata: {} },
    ])
    const req = { sellerId: "seller_1", query: {}, scope: makeScope({ [Modules.ORDER]: { listOrders } }) } as any
    const res = makeRes()
    await GET(req, res)
    expect(res._body.orders[0].shipping_label).toEqual({ status: "generated", tracking_code: "BR1", post_by: "2026-10-25T00:00:00Z" })
    expect(res._body.orders[1].shipping_label).toBeNull()
    expect(JSON.stringify(res._body)).not.toContain("12345678900")
  })
})
