import { Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeScope(overrides: Record<string, unknown> = {}) {
  const orderService = (overrides[Modules.ORDER] as any) ?? {
    retrieveOrder: jest.fn().mockResolvedValue({ id: "order_1" }),
    cancel: jest.fn().mockResolvedValue(undefined),
  }
  const eventBus = (overrides[Modules.EVENT_BUS] as any) ?? { emit: jest.fn().mockResolvedValue(undefined) }
  return {
    scope: {
      resolve: (key: string) => {
        if (key === Modules.ORDER) return orderService
        if (key === Modules.EVENT_BUS) return eventBus
        return {}
      },
    },
    _orderService: orderService,
    _eventBus: eventBus,
  }
}

function makeReq(secretHeader: string | undefined, body: any = {}, scopeOverrides: Record<string, unknown> = {}) {
  const { scope, ...rest } = makeScope(scopeOverrides)
  return {
    headers: secretHeader !== undefined ? { "x-clearsale-secret": secretHeader } : {},
    body,
    scope,
    ...rest,
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /webhooks/clearsale", () => {
  const original = process.env.CLEARSALE_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.CLEARSALE_WEBHOOK_SECRET = "correct-secret"
  })

  afterEach(() => {
    process.env.CLEARSALE_WEBHOOK_SECRET = original
  })

  it("returns 401 when the secret header is missing", async () => {
    const res = makeRes()
    await POST(makeReq(undefined), res)
    expect(res._status).toBe(401)
  })

  it("returns 401 when the secret header does not match", async () => {
    const res = makeRes()
    await POST(makeReq("wrong-secret"), res)
    expect(res._status).toBe(401)
  })

  it("returns 401 when the secret header is a different length than the real secret", async () => {
    const res = makeRes()
    await POST(makeReq("short"), res)
    expect(res._status).toBe(401)
  })

  it("passes auth and returns 400 for a valid secret but missing order_id", async () => {
    const res = makeRes()
    await POST(makeReq("correct-secret", {}), res)
    expect(res._status).toBe(400)
  })

  it("returns 404 when the order doesn't exist", async () => {
    const orderService = { retrieveOrder: jest.fn().mockRejectedValue(new Error("not found")) }
    const req = makeReq("correct-secret", { order_id: "order_missing", status: "APA" }, { [Modules.ORDER]: orderService })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
  })

  it("emits order.clearsale.approved and does not cancel on an approved status", async () => {
    const req = makeReq("correct-secret", { order_id: "order_1", status: "APA", score: 95 })
    const res = makeRes()

    await POST(req, res)

    expect(req._orderService.cancel).not.toHaveBeenCalled()
    expect(req._eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "order.clearsale.approved", data: { id: "order_1", score: 95 } })
    )
    expect(res._status).toBe(200)
  })

  it("cancels the order and emits order.clearsale.rejected on a rejected status", async () => {
    const req = makeReq("correct-secret", { order_id: "order_1", status: "RPA", score: 10 })
    const res = makeRes()

    await POST(req, res)

    expect(req._orderService.cancel).toHaveBeenCalledWith("order_1")
    expect(req._eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "order.clearsale.rejected" })
    )
    expect(res._status).toBe(200)
  })

  it("returns the raw status message when it doesn't match any known ClearSale status", async () => {
    const req = makeReq("correct-secret", { order_id: "order_1", status: "PENDING" })
    const res = makeRes()

    await POST(req, res)

    expect(req._orderService.cancel).not.toHaveBeenCalled()
    expect(req._eventBus.emit).not.toHaveBeenCalled()
    expect(res._body).toEqual({ message: "Evento recebido", status: "PENDING" })
  })
})
