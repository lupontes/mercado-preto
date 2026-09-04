jest.mock("../../utils/whatsapp", () => ({ sendWhatsApp: jest.fn() }))

import { sendWhatsApp } from "../../utils/whatsapp"
import orderPlacedWhatsApp, { config } from "../order-placed-whatsapp"

function makeContainer(orderService: unknown) {
  return {
    resolve: () => orderService,
  }
}

const baseOrder = {
  id: "order_1",
  total: 10000,
  display_id: 1,
  metadata: {},
  shipping_address: { phone: "71999990000", first_name: "João" },
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("orderPlacedWhatsApp", () => {
  it("subscribes to order.placed", () => {
    expect(config.event).toBe("order.placed")
  })

  it("does nothing when the order has no phone on the shipping address", async () => {
    const orderService = {
      retrieveOrder: jest.fn().mockResolvedValue({ ...baseOrder, shipping_address: {} }),
      listOrders: jest.fn(),
    }
    const container = makeContainer(orderService)

    await orderPlacedWhatsApp({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it("sends a single-order message with that order's own total when there's no mercadopago_external_reference (legacy/single-seller order)", async () => {
    const orderService = {
      retrieveOrder: jest.fn().mockResolvedValue(baseOrder),
      listOrders: jest.fn(),
    }
    const container = makeContainer(orderService)

    await orderPlacedWhatsApp({ event: { data: { id: "order_1" } }, container } as any)

    expect(orderService.listOrders).not.toHaveBeenCalled()
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    const [, message] = (sendWhatsApp as jest.Mock).mock.calls[0]
    expect(message).toContain("#1")
    expect(message).toMatch(/R\$\s*100,00/)
  })

  it("sends a single-order message when the payment produced only one order (external_reference set, no siblings)", async () => {
    const orderWithRef = { ...baseOrder, metadata: { mercadopago_external_reference: "ext-1" } }
    const orderService = {
      retrieveOrder: jest.fn().mockResolvedValue(orderWithRef),
      listOrders: jest.fn().mockResolvedValue([orderWithRef]),
    }
    const container = makeContainer(orderService)

    await orderPlacedWhatsApp({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    const [, message] = (sendWhatsApp as jest.Mock).mock.calls[0]
    expect(message).toContain("#1")
    expect(message).toMatch(/R\$\s*100,00/)
  })

  it("sends exactly one consolidated message, with the sum of all orders' totals, when a payment produced multiple orders", async () => {
    const orderA = {
      id: "order_a",
      display_id: 13,
      total: 1079,
      metadata: { mercadopago_external_reference: "ext-1" },
      shipping_address: { phone: "71999990000", first_name: "João" },
    }
    const orderB = {
      id: "order_b",
      display_id: 14,
      total: 19646,
      metadata: { mercadopago_external_reference: "ext-1" },
      shipping_address: { phone: "71999990000", first_name: "João" },
    }
    const orderService = {
      retrieveOrder: jest.fn().mockResolvedValue(orderA),
      listOrders: jest.fn().mockResolvedValue([orderA, orderB]),
    }
    const container = makeContainer(orderService)

    await orderPlacedWhatsApp({ event: { data: { id: "order_a" } }, container } as any)

    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    const [, message] = (sendWhatsApp as jest.Mock).mock.calls[0]
    expect(message).toContain("#13")
    expect(message).toContain("#14")
    expect(message).toMatch(/R\$\s*207,25/) // (1079 + 19646) / 100
  })

  it("only the order designated (lowest id) among the siblings sends the consolidated message — the others skip silently", async () => {
    const orderA = {
      id: "order_a",
      display_id: 13,
      total: 1079,
      metadata: { mercadopago_external_reference: "ext-1" },
      shipping_address: { phone: "71999990000", first_name: "João" },
    }
    const orderB = {
      id: "order_b",
      display_id: 14,
      total: 19646,
      metadata: { mercadopago_external_reference: "ext-1" },
      shipping_address: { phone: "71999990000", first_name: "João" },
    }
    const orderService = {
      retrieveOrder: jest.fn().mockResolvedValue(orderB), // processando o pedido "B" desta vez
      listOrders: jest.fn().mockResolvedValue([orderA, orderB]),
    }
    const container = makeContainer(orderService)

    await orderPlacedWhatsApp({ event: { data: { id: "order_b" } }, container } as any)

    expect(sendWhatsApp).not.toHaveBeenCalled()
  })
})
