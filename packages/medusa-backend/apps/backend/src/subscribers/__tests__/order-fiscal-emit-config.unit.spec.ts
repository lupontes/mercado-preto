import { config } from "../order-fiscal-emit"

describe("orderFiscalEmit config", () => {
  it("subscribes to both mercadopago.order_approved and marketplace.order_placed", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["mercadopago.order_approved", "marketplace.order_placed"])
    )
  })

  it("does not subscribe to test_cash.order_approved (test-cash orders must never emit NF-e)", () => {
    expect(config.event).not.toEqual(expect.arrayContaining(["test_cash.order_approved"]))
  })
})
