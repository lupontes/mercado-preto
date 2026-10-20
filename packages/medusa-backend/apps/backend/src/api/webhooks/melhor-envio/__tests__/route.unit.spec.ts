import crypto from "crypto"
import { POST } from "../route"

const SECRET = "me-secret"

const sign = (raw: string, secret = SECRET) => crypto.createHmac("sha256", secret).update(raw).digest("base64")

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    status: "pending",
    display_id: 7,
    metadata: {
      seller_id: "s1",
      shipping_status: "awaiting_shipment",
      shipping_label: { status: "generated", meOrderIds: ["me-1", "me-2"] },
    },
    ...overrides,
  }
}

function setup(body: unknown, opts: { secret?: string | null; signature?: string | null; orders?: any[] } = {}) {
  if (opts.secret === null) delete process.env.MELHOR_ENVIO_WEBHOOK_SECRET
  else process.env.MELHOR_ENVIO_WEBHOOK_SECRET = opts.secret ?? SECRET
  const raw = JSON.stringify(body)
  const orderService = {
    listOrders: jest.fn().mockResolvedValue(opts.orders ?? [makeOrder()]),
    updateOrders: jest.fn().mockResolvedValue(undefined),
  }
  const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const headers: Record<string, string> = {}
  if (opts.signature !== null) headers["x-me-signature"] = opts.signature ?? sign(raw)
  const req: any = {
    body,
    rawBody: Buffer.from(raw),
    headers,
    scope: {
      resolve: (key: string) => (key === "logger" ? logger : key.includes("order") ? orderService : eventBus),
    },
  }
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }
  return { req, res, orderService, eventBus }
}

const posted = { event: "order.posted", data: { id: "me-2", status: "posted", tracking: "BR123", posted_at: "2026-10-20T10:00:00Z" } }

describe("POST /webhooks/melhor-envio", () => {
  afterEach(() => delete process.env.MELHOR_ENVIO_WEBHOOK_SECRET)

  it("applies the transition and emits shipment_created for a valid signature", async () => {
    const { req, res, orderService, eventBus } = setup(posted)
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const meta = orderService.updateOrders.mock.calls[0][1].metadata
    expect(meta.seller_id).toBe("s1")
    expect(meta.shipping_status).not.toBe("awaiting_shipment")
    expect(eventBus.emit).toHaveBeenCalledWith({ name: "order.shipment_created", data: { id: "order-1", tracking_number: "BR123" } })
  })

  it("rejects an invalid signature with 401 and touches no order", async () => {
    const { req, res, orderService } = setup(posted, { signature: sign("other") })
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(orderService.listOrders).not.toHaveBeenCalled()
    expect(orderService.updateOrders).not.toHaveBeenCalled()
  })

  it("rejects a missing or wrong-length signature with 401", async () => {
    for (const signature of [null, "short"]) {
      const { req, res, orderService } = setup(posted, { signature })
      await POST(req, res)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(orderService.updateOrders).not.toHaveBeenCalled()
    }
  })

  it("answers 503 when no secret is configured", async () => {
    const { req, res, orderService } = setup(posted, { secret: null })
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(orderService.listOrders).not.toHaveBeenCalled()
  })

  it("answers 200 without effect for an unknown label id", async () => {
    const { req, res, orderService } = setup({ ...posted, data: { ...posted.data, id: "nope" } })
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(orderService.updateOrders).not.toHaveBeenCalled()
  })

  it("ignores events other than posted, delivered and cancelled", async () => {
    const { req, res, orderService } = setup({ event: "order.generated", data: { id: "me-1" } })
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(orderService.listOrders).not.toHaveBeenCalled()
  })

  it("maps order.cancelled to the canceled status", async () => {
    const { req, res, orderService } = setup({ event: "order.cancelled", data: { id: "me-1", tracking: null } })
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(orderService.updateOrders).toHaveBeenCalled()
    expect(orderService.updateOrders.mock.calls[0][1].metadata.shipping_label.status).toBe("canceled")
  })
})
