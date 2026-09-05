jest.mock("../../../../utils/mercadolivre-client", () => ({
  getOrder: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  getShipment: jest.fn(),
  getBillingInfo: jest.fn(),
}))

import { Modules } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../modules/marketplace-channel"
import { getOrder, verifyWebhookSignature, getShipment, getBillingInfo } from "../../../../utils/mercadolivre-client"
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
  const res = { _status: 200, _body: undefined as unknown } as any
  res.sendStatus = (code: number) => { res._status = code; return res }
  res.status = (code: number) => {
    res._status = code
    return { json: (body: unknown) => { res._body = body; return res } }
  }
  return res
}

const paidMlOrder = {
  id: 555,
  status: "paid",
  buyer: { id: 1, nickname: "comprador1" },
  order_items: [{ item: { id: "MLB999", title: "Bolsa Africana 2 em 1" }, quantity: 1, unit_price: 182 }],
  shipping: { id: 999 },
  billing_info: { id: "billing-1" },
}

const shipmentAddress = {
  addressLine: "Estrada Geral Cachoeira de Fátima 77",
  zipCode: "88990000",
  cityName: "Praia Grande",
  stateName: "Santa Catarina",
  stateCode: "SC",
}

const billingInfo = { docNumber: "12345678900", name: "Juan", lastName: "Sanchez" }

describe("POST /webhooks/mercadolivre", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.MERCADOLIVRE_WEBHOOK_SECRET = "webhook-secret"
    ;(verifyWebhookSignature as jest.Mock).mockReturnValue(true)
    ;(getShipment as jest.Mock).mockResolvedValue(shipmentAddress)
    ;(getBillingInfo as jest.Mock).mockResolvedValue(billingInfo)
  })

  it("returns 200 without processing when the topic isn't orders_v2", async () => {
    const req = makeReq({ topic: "items", resource: "/items/MLB999" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("returns 500 and rejects the webhook when MERCADOLIVRE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.MERCADOLIVRE_WEBHOOK_SECRET
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(500)
    expect(res._body).toEqual({ error: "Webhook secret not configured" })
    expect(verifyWebhookSignature).not.toHaveBeenCalled()
    expect(getOrder).not.toHaveBeenCalled()
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

  it("creates an order tagged with channel mercado_livre, the resolved seller_id, and the buyer's real document", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(req._channelService.findListingByExternalItemId).toHaveBeenCalledWith("MLB999")
    expect(getBillingInfo).toHaveBeenCalledWith("token-abc", "billing-1")
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata).toEqual(
      expect.objectContaining({
        channel: "mercado_livre",
        mercadolivre_order_id: "555",
        mercadolivre_item_id: "MLB999",
        mercadolivre_shipment_id: 999,
        seller_id: "seller_1",
        buyer_document: "12345678900",
      })
    )
  })

  it("stores buyer_document as null and never calls getBillingInfo when the ML order has no billing_info reference", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue({ ...paidMlOrder, billing_info: undefined })
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(getBillingInfo).not.toHaveBeenCalled()
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata.buyer_document).toBeNull()
  })

  it("still creates the order without a document when fetching billing info fails", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    ;(getBillingInfo as jest.Mock).mockRejectedValue(new Error("Mercado Livre busca de dados fiscais falhou: 404"))
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(req._orderService.createOrders).toHaveBeenCalled()
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata.buyer_document).toBeNull()
  })

  it("attaches a real shipping_address built from the shipment's receiver address", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(getShipment).toHaveBeenCalledWith("token-abc", "999")
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].shipping_address).toEqual(
      expect.objectContaining({
        first_name: "Juan",
        last_name: "Sanchez",
        address_1: "Estrada Geral Cachoeira de Fátima 77",
        city: "Praia Grande",
        province: "SC",
        postal_code: "88990000",
        country_code: "br",
      })
    )
  })

  it("still creates the order without a shipping_address when fetching the shipment fails", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    ;(getShipment as jest.Mock).mockRejectedValue(new Error("Mercado Livre busca de envio falhou: 404"))
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].shipping_address).toBeUndefined()
  })

  it("never fetches the shipment when the ML order carries no shipping id", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue({ ...paidMlOrder, shipping: undefined })
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(getShipment).not.toHaveBeenCalled()
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata.mercadolivre_shipment_id).toBeNull()
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

  it("returns 200 without throwing when the body is malformed (resource is not a string, or the body is empty)", async () => {
    const reqNonStringResource = makeReq({ topic: "orders_v2", resource: 12345 })
    const resA = makeRes()
    await expect(POST(reqNonStringResource, resA)).resolves.not.toThrow()
    expect(resA._status).toBe(200)
    expect(reqNonStringResource._orderService.createOrders).not.toHaveBeenCalled()

    const reqEmptyBody = makeReq(undefined)
    const resB = makeRes()
    await expect(POST(reqEmptyBody, resB)).resolves.not.toThrow()
    expect(resB._status).toBe(200)
  })
})
