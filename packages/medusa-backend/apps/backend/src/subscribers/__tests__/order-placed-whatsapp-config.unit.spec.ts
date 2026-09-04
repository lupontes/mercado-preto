import { config } from "../order-placed-whatsapp"

describe("orderPlacedWhatsApp config", () => {
  it("subscribes to both order.placed and marketplace.order_placed", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["order.placed", "marketplace.order_placed"])
    )
  })
})
