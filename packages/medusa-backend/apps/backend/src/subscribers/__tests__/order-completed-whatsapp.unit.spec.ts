jest.mock("../../utils/whatsapp", () => ({ sendWhatsApp: jest.fn() }))

import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../../utils/whatsapp"
import handler, { config } from "../order-completed-whatsapp"

function makeContainer(order: unknown) {
  const orderService = { retrieveOrder: jest.fn().mockResolvedValue(order) }
  return { resolve: (key: string) => (key === Modules.ORDER ? orderService : undefined) } as any
}

const order = (address: Record<string, unknown> | null) => ({ id: "order_1", display_id: 42, shipping_address: address })

beforeEach(() => jest.clearAllMocks())

describe("orderCompletedWhatsApp", () => {
  it("tells the buyer the order was delivered", async () => {
    await handler({ event: { data: { id: "order_1" } }, container: makeContainer(order({ phone: "71999990000", first_name: "Ana" })) } as any)

    const [phone, text] = (sendWhatsApp as jest.Mock).mock.calls[0]
    expect(phone).toBe("71999990000")
    expect(text).toContain("Olá Ana")
    expect(text).toContain("*#42*")
    expect(text).toContain("entregue")
  })

  it.each([[order({ first_name: "Ana" })], [null]])("sends nothing without a phone or order %#", async (o) => {
    await handler({ event: { data: { id: "order_1" } }, container: makeContainer(o) } as any)
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it("listens to completed orders", () => {
    expect(config.event).toBe("order.completed")
  })
})
