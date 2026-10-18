jest.mock("../../utils/whatsapp", () => ({ sendWhatsApp: jest.fn() }))

import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../../utils/whatsapp"
import handler, { config } from "../order-shipped-whatsapp"

function makeContainer(order: unknown) {
  const orderService = { retrieveOrder: jest.fn().mockResolvedValue(order) }
  return { resolve: (key: string) => (key === Modules.ORDER ? orderService : undefined) } as any
}

const order = (address: Record<string, unknown> | null) => ({ id: "order_1", display_id: 42, shipping_address: address })

beforeEach(() => jest.clearAllMocks())

describe("orderShippedWhatsApp", () => {
  it("tells the buyer the order shipped, with the tracking code", async () => {
    await handler({ event: { data: { id: "order_1", tracking_number: "BR123" } }, container: makeContainer(order({ phone: "71999990000", first_name: "Ana" })) } as any)

    const [phone, text] = (sendWhatsApp as jest.Mock).mock.calls[0]
    expect(phone).toBe("71999990000")
    expect(text).toContain("Olá Ana")
    expect(text).toContain("*#42*")
    expect(text).toContain("*BR123*")
  })

  it("leaves the tracking line out when there is no code", async () => {
    await handler({ event: { data: { id: "order_1" } }, container: makeContainer(order({ phone: "71999990000", first_name: "Ana" })) } as any)
    expect((sendWhatsApp as jest.Mock).mock.calls[0][1]).not.toContain("rastreamento")
  })

  it("greets a buyer without a first name as Cliente", async () => {
    await handler({ event: { data: { id: "order_1" } }, container: makeContainer(order({ phone: "71999990000" })) } as any)
    expect((sendWhatsApp as jest.Mock).mock.calls[0][1]).toContain("Olá Cliente")
  })

  it.each([[order({ first_name: "Ana" })], [order(null)], [null]])("sends nothing without a phone or order %#", async (o) => {
    await handler({ event: { data: { id: "order_1" } }, container: makeContainer(o) } as any)
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it("listens to shipments", () => {
    expect(config.event).toBe("order.shipment_created")
  })
})
