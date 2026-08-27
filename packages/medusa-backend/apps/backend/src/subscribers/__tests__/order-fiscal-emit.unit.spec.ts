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
