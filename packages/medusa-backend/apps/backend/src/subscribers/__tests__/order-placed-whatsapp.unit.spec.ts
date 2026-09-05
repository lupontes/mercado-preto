jest.mock("../../utils/whatsapp", () => ({ sendWhatsApp: jest.fn() }))

import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../../utils/whatsapp"
import orderPlacedWhatsApp from "../order-placed-whatsapp"

function makeContainer(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

describe("orderPlacedWhatsApp", () => {
  beforeEach(() => jest.clearAllMocks())

  it("never sends a message for orders from the mercado_livre channel, even if a real phone is present", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue({
      id: "order_1",
      total: 10000,
      display_id: 42,
      metadata: { channel: "mercado_livre" },
      shipping_address: { phone: "5571988887777", first_name: "Juan" },
    })
    const container = makeContainer({ [Modules.ORDER]: { retrieveOrder } })

    await orderPlacedWhatsApp({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it("sends a message for a regular (non mercado_livre) order with a phone", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue({
      id: "order_1",
      total: 10000,
      display_id: 42,
      metadata: {},
      shipping_address: { phone: "5571988887777", first_name: "Maria" },
    })
    const container = makeContainer({ [Modules.ORDER]: { retrieveOrder } })

    await orderPlacedWhatsApp({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendWhatsApp).toHaveBeenCalledWith("5571988887777", expect.stringContaining("#42"))
  })
})
