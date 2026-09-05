jest.mock("../../utils/whatsapp", () => ({ sendWhatsApp: jest.fn() }))

import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../../utils/whatsapp"
import orderPlacedWhatsApp from "../order-placed-whatsapp"

function makeContainer(orderService: unknown, logger: unknown = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }) {
  return {
    resolve: (key: string) => {
      if (key === Modules.ORDER) return orderService
      if (key === "logger") return logger
      throw new Error(`Unexpected resolve: ${key}`)
    },
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
  // Cobertura de config.event está em order-placed-whatsapp-config.unit.spec.ts
  // (precisa ser array — escuta também marketplace.order_placed, do canal ML).

  it("never sends a message for orders from the mercado_livre channel, even if a real phone is present", async () => {
    const orderService = {
      retrieveOrder: jest.fn().mockResolvedValue({
        ...baseOrder,
        metadata: { channel: "mercado_livre" },
        shipping_address: { phone: "5571988887777", first_name: "Juan" },
      }),
      listOrders: jest.fn(),
    }
    const container = makeContainer(orderService)

    await orderPlacedWhatsApp({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(orderService.listOrders).not.toHaveBeenCalled()
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

  it("still sends a message for an order created before metadata existed (metadata missing entirely)", async () => {
    const orderService = {
      retrieveOrder: jest.fn().mockResolvedValue({ ...baseOrder, metadata: undefined }),
      listOrders: jest.fn(),
    }
    const container = makeContainer(orderService)

    await orderPlacedWhatsApp({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendWhatsApp).toHaveBeenCalledWith("71999990000", expect.stringContaining("#1"))
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
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const container = makeContainer(orderService, logger)

    await orderPlacedWhatsApp({ event: { data: { id: "order_b" } }, container } as any)

    expect(sendWhatsApp).not.toHaveBeenCalled()
    // o pedido não-designado não deve nem logar tentativa de envio
    expect(logger.info).not.toHaveBeenCalled()
  })

  it("logs the prepared message (recipient, order label, total) right before sending — the only way to verify the consolidation in an environment without Evolution API credentials configured (sendWhatsApp itself no-ops silently there)", async () => {
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
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const container = makeContainer(orderService, logger)

    await orderPlacedWhatsApp({ event: { data: { id: "order_a" } }, container } as any)

    expect(logger.info).toHaveBeenCalledTimes(1)
    const [logLine] = logger.info.mock.calls[0]
    expect(logLine).toContain("71999990000")
    expect(logLine).toContain("#13")
    expect(logLine).toContain("#14")
    expect(logLine).toMatch(/R\$\s*207,25/)
  })
})
