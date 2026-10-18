import CommissionModuleService from "../service"

// calculate() only needs getCommissionRate when no rate is given.
const calculate = (input: any) =>
  CommissionModuleService.prototype.calculate.call({ getCommissionRate: async () => 15 } as any, input)

describe("CommissionModuleService.calculate", () => {
  const base = { orderId: "o1", sellerId: "s1", grossAmount: 10000, bankingFees: 500, shippingAmount: 1500 }

  it("keeps the seller payout unchanged when the platform pays a points discount", async () => {
    const without = await calculate(base)
    const withDiscount = await calculate({ ...base, loyaltyDiscount: 300 })

    expect(withDiscount.sellerPayout).toBe(without.sellerPayout)
    expect(withDiscount.commissionAmount).toBe(without.commissionAmount)
    expect(withDiscount.loyaltyDiscount).toBe(300)
  })

  it("records zero discount by default", async () => {
    expect((await calculate(base)).loyaltyDiscount).toBe(0)
  })
})
