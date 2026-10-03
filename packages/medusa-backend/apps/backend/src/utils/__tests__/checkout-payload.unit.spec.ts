import { buildCheckoutSnapshot, checkoutRequestSchema, type CheckoutRequest } from "../checkout-payload"

const request: CheckoutRequest = {
  items: [
    { title: "Camiseta", quantity: 2, price: 7900, variantId: "var-1", productId: "prod-1" },
    { title: "Boné", quantity: 1, price: 5000, variantId: "var-2", productId: "prod-2" },
  ],
  address: {
    firstName: "João",
    lastName: "Silva",
    email: "joao@email.com",
    phone: "71999990000",
    cep: "44300-000",
    address1: "Rua das Flores",
    address2: "100",
    city: "Cachoeira",
    state: "BA",
  },
  shipping: { id: "pac", name: "PAC", price: 2500 },
  total: 23300,
  document: "111.444.777-35",
}

function makeQuery(sellers: Record<string, string>) {
  return {
    graph: jest.fn().mockResolvedValue({
      data: Object.entries(sellers).map(([id, sellerId]) => ({ id, seller: { id: sellerId } })),
    }),
  }
}

describe("checkoutRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(checkoutRequestSchema.safeParse(request).success).toBe(true)
  })

  it("rejects an empty items array", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, items: [] }).success).toBe(false)
  })

  it("rejects an invalid CPF/CNPJ", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, document: "123" }).success).toBe(false)
  })
})

describe("buildCheckoutSnapshot", () => {
  it("builds the snapshot payload with seller groups, digits-only document and CEP", async () => {
    const query = makeQuery({ "prod-1": "seller-a", "prod-2": "seller-b" })

    const result = await buildCheckoutSnapshot(query, request)

    expect(query.graph).toHaveBeenCalledWith({
      entity: "product",
      fields: ["id", "seller.id"],
      filters: { id: ["prod-1", "prod-2"] },
    })
    if (!("payload" in result)) throw new Error("expected payload")
    expect(result.payload.buyer_document).toBe("11144477735")
    expect(result.payload.address.postal_code).toBe("44300000")
    expect(result.payload.seller_groups.map((g) => g.sellerId)).toEqual(["seller-a", "seller-b"])
    expect(result.payload.items).toEqual([
      { variant_id: "var-1", title: "Camiseta", quantity: 2, price: 7900 },
      { variant_id: "var-2", title: "Boné", quantity: 1, price: 5000 },
    ])
    expect(result.payload.shipping).toEqual({ id: "pac", name: "PAC", price: 2500 })
    expect(result.payload.total).toBe(23300)
  })

  it("returns unresolvedProductId when a product has no seller", async () => {
    const query = makeQuery({ "prod-1": "seller-a" })

    const result = await buildCheckoutSnapshot(query, request)

    expect(result).toEqual({ unresolvedProductId: "prod-2" })
  })
})
