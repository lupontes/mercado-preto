import { allocateLoyaltyDiscount, loyaltyDiscountCap } from "../loyalty-discount"

describe("allocateLoyaltyDiscount", () => {
  it("splits proportionally and keeps the exact total", () => {
    const split = allocateLoyaltyDiscount([{ sellerId: "a", itemsTotal: 10000 }, { sellerId: "b", itemsTotal: 5000 }], 101)
    expect(split.a + split.b).toBe(101)
    expect(split).toEqual({ a: 68, b: 33 })
  })

  it("gives everything to a single store", () => {
    expect(allocateLoyaltyDiscount([{ sellerId: "a", itemsTotal: 3000 }], 50)).toEqual({ a: 50 })
  })

  it("splits nothing when there is no discount", () => {
    expect(allocateLoyaltyDiscount([{ sellerId: "a", itemsTotal: 1 }, { sellerId: "b", itemsTotal: 1 }], 0)).toEqual({ a: 0, b: 0 })
  })
})

describe("loyaltyDiscountCap", () => {
  it("is the platform commission on the items", () => {
    expect(loyaltyDiscountCap(10000, 15)).toBe(1500)
    expect(loyaltyDiscountCap(999, 15)).toBe(149)
  })
})
