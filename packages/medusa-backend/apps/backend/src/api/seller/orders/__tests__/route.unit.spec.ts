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
  it("requests status, total, created_at and display_id in select — otherwise Medusa returns them undefined (the same select-whitelist quirk documented in commission-on-payment.ts and order-fiscal-emit.ts), leaving the panel's Total/Status/Data columns blank", async () => {
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
        select: expect.arrayContaining(["status", "total", "created_at", "display_id"]),
      })
    )
  })

  it("returns the orders scoped to the seller, with pagination metadata", async () => {
    const orders = [{ id: "order_1" }, { id: "order_2" }]
    const listOrders = jest.fn().mockResolvedValue(orders)
    const req = {
      sellerId: "seller_1",
      query: { limit: "10", offset: "5" },
      scope: makeScope({ [Modules.ORDER]: { listOrders } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body).toEqual({ orders, count: 2, limit: 10, offset: 5 })
  })
})
