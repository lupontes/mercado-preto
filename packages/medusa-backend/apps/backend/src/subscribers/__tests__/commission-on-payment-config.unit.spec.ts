import { config } from "../commission-on-payment"

describe("commissionOnPayment config", () => {
  it("subscribes to both order.payment_captured and marketplace.order_placed", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["order.payment_captured", "marketplace.order_placed"])
    )
  })
})
