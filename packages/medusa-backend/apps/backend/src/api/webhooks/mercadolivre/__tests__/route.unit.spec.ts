jest.mock("../../../../utils/mercadolivre-client", () => ({
  getOrder: jest.fn(),
  verifyWebhookSignature: jest.fn(),
}))

import { Modules } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../modules/marketplace-channel"
import { getOrder, verifyWebhookSignature } from "../../../../utils/mercadolivre-client"
import { POST } from "../route"

function makeReq(body: unknown, overrides: Record<string, unknown> = {}) {
  const orderService = {
    listOrders: jest.fn().mockResolvedValue([]),
    createOrders: jest.fn().mockResolvedValue([{ id: "order_1" }]),
  }
  const eventBusService = { emit: jest.fn().mockResolvedValue(undefined) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const channelService = {
    getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }),
    findListingByExternalItemId: jest.fn().mockResolvedValue({ sellerId: "seller_1" }),
  }
  return {
    body,
    headers: { "x-signature": "ts=1700000000,v1=abcdef", "x-request-id": "req-1" },
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === MARKETPLACE_CHANNEL_MODULE) return channelService
        if (key === Modules.ORDER) return orderService
        if (key === Modules.EVENT_BUS) return eventBusService
        return {}
      },
    },
    _orderService: orderService,
    _eventBusService: eventBusService,
    _channelService: channelService,
    ...overrides,
  } as any
}

function makeRes() {
  const res = { _status: 200 } as any
  res.sendStatus = (code: number) => { res._status = code; return res }
  return res
}

const paidMlOrder = {
  id: 555,
  status: "paid",
  buyer: { id: 1, nickname: "comprador1", billing_info: { doc_number: "12345678900", doc_type: "CPF" } },
  order_items: [{ item: { id: "MLB999", title: "Bolsa Africana 2 em 1" }, quantity: 1, unit_price: 182 }],
}

describe("POST /webhooks/mercadolivre", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.MERCADOLIVRE_WEBHOOK_SECRET = "webhook-secret"
    ;(verifyWebhookSignature as jest.Mock).mockReturnValue(true)
  })

  it("returns 200 without processing when the topic isn't orders_v2", async () => {
    const req = makeReq({ topic: "items", resource: "/items/MLB999" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("returns 200 without processing when the signature is invalid", async () => {
    ;(verifyWebhookSignature as jest.Mock).mockReturnValue(false)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(getOrder).not.toHaveBeenCalled()
  })

  it("returns 200 without creating an order when the ML order isn't paid yet", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue({ ...paidMlOrder, status: "pending" })
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("creates an order tagged with channel mercado_livre, the resolved seller_id, and the buyer's document", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(req._channelService.findListingByExternalItemId).toHaveBeenCalledWith("MLB999")
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata).toEqual(
      expect.objectContaining({
        channel: "mercado_livre",
        mercadolivre_order_id: "555",
        seller_id: "seller_1",
        buyer_document: "12345678900",
      })
    )
  })

  it("stores buyer_document as null when the ML order has no billing info", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue({ ...paidMlOrder, buyer: { id: 1, nickname: "comprador1" } })
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata.buyer_document).toBeNull()
  })

  it("stores unit_price in centavos (no /100 conversion)", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].items[0].unit_price).toBe(18200)
  })

  it("emits marketplace.order_placed after creating the order", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(req._eventBusService.emit).toHaveBeenCalledWith([
      expect.objectContaining({ name: "marketplace.order_placed", data: { id: "order_1" } }),
    ])
  })

  it("does not create a duplicate order when the ML order was already processed", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    req._orderService.listOrders.mockResolvedValue([{ id: "order_existing" }])

    await POST(req, makeRes())

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("does not create an order when the item's channel_listing isn't found locally", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    req._channelService.findListingByExternalItemId.mockResolvedValue(null)

    await POST(req, makeRes())

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("returns 200 even when an unexpected error occurs", async () => {
    ;(getOrder as jest.Mock).mockRejectedValue(new Error("network error"))
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
  })
})
