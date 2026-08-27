import { groupItemsBySeller, type PreferenceItem } from "../seller-order-groups"

const item = (overrides: Partial<PreferenceItem>): PreferenceItem => ({
  title: "Item",
  quantity: 1,
  price: 1000,
  productId: "prod-1",
  ...overrides,
})

describe("groupItemsBySeller", () => {
  it("returns a single group when all items belong to the same seller", () => {
    const items = [item({ productId: "prod-1", price: 1000 }), item({ productId: "prod-1", price: 500 })]
    const result = groupItemsBySeller(items, { "prod-1": "seller-a" }, 0)

    expect("groups" in result && result.groups).toEqual([
      { sellerId: "seller-a", subtotal: 1500, shippingShare: 0, items: expect.any(Array) },
    ])
  })

  it("splits items from different sellers into separate groups", () => {
    const items = [
      item({ productId: "prod-1", price: 1000 }),
      item({ productId: "prod-2", price: 500 }),
    ]
    const result = groupItemsBySeller(items, { "prod-1": "seller-a", "prod-2": "seller-b" }, 0)

    expect("groups" in result).toBe(true)
    const groups = (result as { groups: any[] }).groups
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.sellerId).sort()).toEqual(["seller-a", "seller-b"])
  })

  it("splits shipping proportionally to each group's subtotal", () => {
    const items = [
      item({ productId: "prod-1", price: 7500 }), // 75% do subtotal
      item({ productId: "prod-2", price: 2500 }), // 25% do subtotal
    ]
    const result = groupItemsBySeller(items, { "prod-1": "seller-a", "prod-2": "seller-b" }, 1000)

    const groups = (result as { groups: any[] }).groups
    const a = groups.find((g) => g.sellerId === "seller-a")
    const b = groups.find((g) => g.sellerId === "seller-b")
    expect(a.shippingShare).toBe(750)
    expect(b.shippingShare).toBe(250)
  })

  it("assigns the rounding remainder to the group with the largest subtotal", () => {
    // subtotais 100 / 90 / 110 (total 300) sobre frete 1000 não dividem exato:
    // floor(1000*100/300)=333, floor(1000*90/300)=300, floor(1000*110/300)=366 → soma 999, falta 1.
    // O centavo que falta vai para seller-c (maior subtotal, 110), sem ambiguidade de empate.
    const items = [
      item({ productId: "prod-1", price: 100 }), // seller-a
      item({ productId: "prod-2", price: 90 }),  // seller-b
      item({ productId: "prod-3", price: 110 }), // seller-c — maior subtotal
    ]
    const result = groupItemsBySeller(
      items,
      { "prod-1": "seller-a", "prod-2": "seller-b", "prod-3": "seller-c" },
      1000
    )

    const groups = (result as { groups: any[] }).groups
    const totalShipping = groups.reduce((sum, g) => sum + g.shippingShare, 0)
    expect(totalShipping).toBe(1000) // nunca perde nem ganha centavo no total

    const byId = Object.fromEntries(groups.map((g) => [g.sellerId, g.shippingShare]))
    expect(byId["seller-a"]).toBe(333)
    expect(byId["seller-b"]).toBe(300)
    expect(byId["seller-c"]).toBe(367) // 366 + o centavo do resto
  })

  it("returns unresolvedProductId when an item's product has no known seller", () => {
    const items = [item({ productId: "prod-ghost" })]
    const result = groupItemsBySeller(items, {}, 0)

    expect(result).toEqual({ unresolvedProductId: "prod-ghost" })
  })

  it("returns an empty group list for an empty cart without dividing by zero", () => {
    const result = groupItemsBySeller([], {}, 500)
    expect(result).toEqual({ groups: [] })
  })
})
