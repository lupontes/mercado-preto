import { Modules } from "@medusajs/framework/utils"
import orderFiscalEmit from "../order-fiscal-emit"

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
  items: [{ title: "Bolsa Africana 2 em 1", quantity: 1, unit_price: 15000 }],
}

describe("orderFiscalEmit", () => {
  it("requests total/metadata/email in select — select is a whitelist, so any field read from order.* must be listed or comes back undefined", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue(baseOrder)
    const emitNfe = jest.fn()
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      fiscal: { emitNfe },
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
    })

    await orderFiscalEmit({ event: { data: { id: "order_1" } }, container } as any)

    expect(emitNfe).not.toHaveBeenCalled()
  })
})
