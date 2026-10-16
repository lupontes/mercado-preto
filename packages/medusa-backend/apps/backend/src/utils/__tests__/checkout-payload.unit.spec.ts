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
  shipping: { tier: "economico", expectedTotal: 5500 },
  document: "111.444.777-35",
}

const option = {
  tier: "economico" as const, label: "Econômico", total: 5500, deliveryDays: 11,
  sellers: [
    { sellerId: "seller-a", sellerName: "A", tier: "economico" as const, service: "PAC" as const, serviceId: 1, price: 2500, deliveryDays: 9 },
    { sellerId: "seller-b", sellerName: "B", tier: "economico" as const, service: "PAC" as const, serviceId: 1, price: 3000, deliveryDays: 7 },
  ],
}

const productByVariant: Record<string, string> = { "var-1": "prod-1", "var-2": "prod-2" }

// Same two lookups quoteShipping does: variant → product, then product → seller.
function makeQuery(sellerByProduct: Record<string, string>) {
  return {
    graph: jest.fn(async ({ entity, filters }: any) => ({
      data:
        entity === "product_variant"
          ? filters.id.filter((id: string) => productByVariant[id]).map((id: string) => ({ id, product_id: productByVariant[id] }))
          : filters.id.filter((id: string) => sellerByProduct[id]).map((id: string) => ({ id, seller: { id: sellerByProduct[id] } })),
    })),
  }
}

describe("checkoutRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(checkoutRequestSchema.safeParse(request).success).toBe(true)
  })

  it("rejects an empty items array", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, items: [] }).success).toBe(false)
  })

  it("rejects more than 50 items", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ ...request.items[0], variantId: `var-${i}` }))
    expect(checkoutRequestSchema.safeParse({ ...request, items }).success).toBe(false)
    expect(checkoutRequestSchema.safeParse({ ...request, items: items.slice(0, 50) }).success).toBe(true)
  })

  it("accepts a CEP with or without the dash and rejects one without 8 digits", () => {
    const withCep = (cep: string) => ({ ...request, address: { ...request.address, cep } })
    expect(checkoutRequestSchema.safeParse(withCep("44300-000")).success).toBe(true)
    expect(checkoutRequestSchema.safeParse(withCep("44300000")).success).toBe(true)
    for (const cep of ["", "123", "44300-00", "443000000", "abcde-fgh"]) {
      expect(checkoutRequestSchema.safeParse(withCep(cep)).success).toBe(false)
    }
  })

  it("rejects an invalid CPF/CNPJ", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, document: "123" }).success).toBe(false)
  })
})

describe("buildCheckoutSnapshot", () => {
  it("builds the snapshot payload with seller groups, digits-only document and CEP", async () => {
    const query = makeQuery({ "prod-1": "seller-a", "prod-2": "seller-b" })

    const result = await buildCheckoutSnapshot(query, request, option)

    expect(query.graph).toHaveBeenCalledWith({
      entity: "product_variant",
      fields: ["id", "product_id"],
      filters: { id: ["var-1", "var-2"] },
    })
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
  })

  it("stores each seller's real shipping and the server-side total", async () => {
    const query = makeQuery({ "prod-1": "seller-a", "prod-2": "seller-b" })
    const result = await buildCheckoutSnapshot(query, request, option)
    if (!("payload" in result)) throw new Error("expected payload")
    expect(result.payload.seller_groups.map((g) => g.shippingShare)).toEqual([2500, 3000])
    expect(result.payload.shipping).toEqual({ id: "economico", name: "Econômico", price: 5500 })
    expect(result.payload.total).toBe(2 * 7900 + 5000 + 5500)
  })

  it("rejects the old shipping shape (price sent by the browser)", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, shipping: { id: "pac", name: "PAC", price: 1 } }).success).toBe(false)
  })

  it("returns unresolvedVariantId when a variant's product has no seller", async () => {
    const query = makeQuery({ "prod-1": "seller-a" })

    const result = await buildCheckoutSnapshot(query, request, option)

    expect(result).toEqual({ unresolvedVariantId: "var-2" })
  })

  it("groups by the variant's seller even when the browser sends another seller's productId", async () => {
    const query = makeQuery({ "prod-1": "seller-a", "prod-2": "seller-b" })
    const tampered: CheckoutRequest = {
      ...request,
      items: [
        { ...request.items[0], productId: "prod-2" },
        { ...request.items[1], productId: "prod-1" },
      ],
    }

    const result = await buildCheckoutSnapshot(query, tampered, option)

    if (!("payload" in result)) throw new Error("expected payload")
    expect(result.payload.seller_groups.map((g) => [g.sellerId, g.subtotal, g.shippingShare])).toEqual([
      ["seller-a", 2 * 7900, 2500],
      ["seller-b", 5000, 3000],
    ])
    expect(query.graph).not.toHaveBeenCalledWith(expect.objectContaining({ filters: { id: ["prod-2", "prod-1"] } }))
  })
})
