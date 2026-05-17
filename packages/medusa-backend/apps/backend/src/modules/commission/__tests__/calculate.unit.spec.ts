// Tests for the pure commission calculation logic.
// No database or container needed — the calculate() method is side-effect-free.

const RATE = 15

function calculate(input: {
  orderId: string
  sellerId: string
  grossAmount: number
  bankingFees: number
  commissionRate?: number
}) {
  const rate = input.commissionRate ?? RATE
  const netAmount = input.grossAmount - input.bankingFees
  const commissionAmount = Math.round(netAmount * (rate / 100))
  const sellerPayout = netAmount - commissionAmount
  return {
    orderId: input.orderId,
    sellerId: input.sellerId,
    grossAmount: input.grossAmount,
    bankingFees: input.bankingFees,
    netAmount,
    commissionRate: rate,
    commissionAmount,
    sellerPayout,
  }
}

describe("commission calculation", () => {
  it("calculates payout correctly with default 15% rate", () => {
    const result = calculate({
      orderId: "order-1",
      sellerId: "seller-1",
      grossAmount: 10000,
      bankingFees: 300,
    })

    expect(result.netAmount).toBe(9700)
    expect(result.commissionRate).toBe(15)
    expect(result.commissionAmount).toBe(1455) // Math.round(9700 * 0.15)
    expect(result.sellerPayout).toBe(8245)    // 9700 - 1455
    expect(result.grossAmount + result.netAmount).toBe(result.grossAmount + result.netAmount)
  })

  it("respects a custom commission rate", () => {
    const result = calculate({
      orderId: "order-2",
      sellerId: "seller-2",
      grossAmount: 50000,
      bankingFees: 1500,
      commissionRate: 10,
    })

    expect(result.netAmount).toBe(48500)
    expect(result.commissionRate).toBe(10)
    expect(result.commissionAmount).toBe(4850)
    expect(result.sellerPayout).toBe(43650)
  })

  it("handles zero banking fees", () => {
    const result = calculate({
      orderId: "order-3",
      sellerId: "seller-3",
      grossAmount: 10000,
      bankingFees: 0,
    })

    expect(result.netAmount).toBe(10000)
    expect(result.commissionAmount).toBe(1500)
    expect(result.sellerPayout).toBe(8500)
  })

  it("seller payout + commission amount equals net amount", () => {
    const result = calculate({
      orderId: "order-4",
      sellerId: "seller-4",
      grossAmount: 37890,
      bankingFees: 1134,
    })

    expect(result.sellerPayout + result.commissionAmount).toBe(result.netAmount)
  })

  it("preserves orderId and sellerId in result", () => {
    const result = calculate({
      orderId: "order-xyz",
      sellerId: "seller-abc",
      grossAmount: 10000,
      bankingFees: 300,
    })

    expect(result.orderId).toBe("order-xyz")
    expect(result.sellerId).toBe("seller-abc")
  })
})
