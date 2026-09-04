import { config } from "../order-fiscal-emit"

describe("orderFiscalEmit config", () => {
  it("subscribes to both mercadopago.order_approved and marketplace.order_placed", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["mercadopago.order_approved", "marketplace.order_placed"])
    )
  })
})
