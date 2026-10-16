import { groupItemsBySeller, type PreferenceItem } from "../seller-order-groups"
import type { SellerShipping } from "../shipping-quote"

const item = (overrides: Partial<PreferenceItem>): PreferenceItem => ({
  title: "Item", quantity: 1, price: 1000, productId: "prod-1", variantId: "var-1", ...overrides,
})
const pac = (sellerId: string, price: number): SellerShipping => ({
  sellerId, sellerName: sellerId, tier: "economico", service: "PAC", serviceId: 1, price, deliveryDays: 9,
})

describe("groupItemsBySeller", () => {
  it("uses each seller's real shipping price as its share and keeps the chosen service", () => {
    const result = groupItemsBySeller(
      [item({ productId: "prod-1", price: 7900 }), item({ productId: "prod-2", price: 5000, variantId: "var-2" })],
      { "var-1": "seller-a", "var-2": "seller-b" },
      { "seller-a": pac("seller-a", 3679), "seller-b": pac("seller-b", 8190) }
    )
    if (!("groups" in result)) throw new Error("expected groups")
    expect(result.groups.map((g) => [g.sellerId, g.subtotal, g.shippingShare])).toEqual([
      ["seller-a", 7900, 3679],
      ["seller-b", 5000, 8190],
    ])
    expect(result.groups[0].shipping).toEqual({ tier: "economico", service: "PAC", serviceId: 1, price: 3679, deliveryDays: 9 })
  })

  it("groups several items of the same seller into one group", () => {
    const result = groupItemsBySeller(
      [item({ price: 1000 }), item({ price: 500, quantity: 2, variantId: "var-2" })],
      { "var-1": "seller-a", "var-2": "seller-a" },
      { "seller-a": pac("seller-a", 2000) }
    )
    if (!("groups" in result)) throw new Error("expected groups")
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].subtotal).toBe(2000)
    expect(result.groups[0].items).toHaveLength(2)
  })

  it("reports a variant without seller", () => {
    expect(groupItemsBySeller([item({ variantId: "x" })], {}, {})).toEqual({ unresolvedVariantId: "x" })
  })

  it("groups by the variant's seller and ignores the productId sent by the browser", () => {
    const result = groupItemsBySeller(
      [item({ variantId: "var-1", productId: "prod-of-seller-b" })],
      { "var-1": "seller-a" },
      { "seller-a": pac("seller-a", 2000), "seller-b": pac("seller-b", 1) }
    )
    if (!("groups" in result)) throw new Error("expected groups")
    expect(result.groups.map((g) => [g.sellerId, g.shippingShare])).toEqual([["seller-a", 2000]])
  })
})
