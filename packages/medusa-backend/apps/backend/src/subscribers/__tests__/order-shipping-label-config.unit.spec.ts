import { config } from "../order-shipping-label"

describe("orderShippingLabel config", () => {
  it("subscribes only to mercadopago.order_approved (test-cash orders never get a label)", () => {
    expect(config.event).toBe("mercadopago.order_approved")
  })
})
