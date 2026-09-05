import { config } from "../commission-on-payment"

describe("commissionOnPayment config", () => {
  it("subscribes to mercadopago.order_approved — the event the MercadoPago webhook actually emits for created orders — and marketplace.order_placed; never to order.payment_captured, which is not a real Medusa v2 event and is never emitted anywhere in this codebase", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["mercadopago.order_approved", "marketplace.order_placed"])
    )
    expect(config.event).not.toEqual(expect.arrayContaining(["order.payment_captured"]))
  })
})
