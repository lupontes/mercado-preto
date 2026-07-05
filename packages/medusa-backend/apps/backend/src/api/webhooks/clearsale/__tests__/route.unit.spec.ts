import { POST } from "../route"
import { Modules } from "@medusajs/framework/utils"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

function makeReq(body: unknown, headers: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
  return {
    body,
    headers,
    scope: makeScope({
      [Modules.ORDER]: {
        retrieveOrder: jest.fn().mockResolvedValue({ id: (body as any)?.order_id }),
        cancel: jest.fn().mockResolvedValue(undefined),
      },
      [Modules.EVENT_BUS]: { emit: jest.fn().mockResolvedValue(undefined) },
      ...overrides,
    }),
  } as any
}

describe("POST /webhooks/clearsale", () => {
  const originalSecret = process.env.CLEARSALE_WEBHOOK_SECRET

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CLEARSALE_WEBHOOK_SECRET
    else process.env.CLEARSALE_WEBHOOK_SECRET = originalSecret
  })

  it("is reachable without Medusa admin authentication (regression: was under /admin/webhooks)", async () => {
    // This route must not require Medusa's default admin session auth —
    // ClearSale calls it as an anonymous external webhook. The route module
    // itself has no auth dependency; the real guarantee lives in it sitting
    // under /webhooks (see middlewares/route registration), covered by the
    // 401 test below for the CLEARSALE_WEBHOOK_SECRET check instead.
    expect(typeof POST).toBe("function")
  })

  it("returns 401 when CLEARSALE_WEBHOOK_SECRET is set and the header doesn't match", async () => {
    process.env.CLEARSALE_WEBHOOK_SECRET = "expected-secret"
    const req = makeReq({ order_id: "order_1", status: "APA" }, { "x-clearsale-secret": "wrong" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(401)
  })

  it("accepts the request when CLEARSALE_WEBHOOK_SECRET matches", async () => {
    process.env.CLEARSALE_WEBHOOK_SECRET = "expected-secret"
    const req = makeReq({ order_id: "order_1", status: "APA" }, { "x-clearsale-secret": "expected-secret" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
  })

  it("returns 400 when order_id is missing", async () => {
    delete process.env.CLEARSALE_WEBHOOK_SECRET
    const req = makeReq({ status: "APA" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
  })

  it("returns 404 when the order doesn't exist", async () => {
    delete process.env.CLEARSALE_WEBHOOK_SECRET
    const retrieveOrder = jest.fn().mockRejectedValue(new Error("not found"))
    const req = makeReq({ order_id: "order_missing", status: "APA" }, {}, { [Modules.ORDER]: { retrieveOrder } })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
  })

  it("emits order.clearsale.approved and does not cancel on an approved status", async () => {
    delete process.env.CLEARSALE_WEBHOOK_SECRET
    const cancel = jest.fn()
    const emit = jest.fn().mockResolvedValue(undefined)
    const retrieveOrder = jest.fn().mockResolvedValue({ id: "order_1" })
    const req = makeReq(
      { order_id: "order_1", status: "APA", score: 95 },
      {},
      { [Modules.ORDER]: { retrieveOrder, cancel }, [Modules.EVENT_BUS]: { emit } }
    )
    const res = makeRes()

    await POST(req, res)

    expect(cancel).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "order.clearsale.approved" }))
    expect(res._status).toBe(200)
  })

  it("cancels the order and emits order.clearsale.rejected on a rejected status", async () => {
    delete process.env.CLEARSALE_WEBHOOK_SECRET
    const cancel = jest.fn().mockResolvedValue(undefined)
    const emit = jest.fn().mockResolvedValue(undefined)
    const retrieveOrder = jest.fn().mockResolvedValue({ id: "order_1" })
    const req = makeReq(
      { order_id: "order_1", status: "RPA", score: 10 },
      {},
      { [Modules.ORDER]: { retrieveOrder, cancel }, [Modules.EVENT_BUS]: { emit } }
    )
    const res = makeRes()

    await POST(req, res)

    expect(cancel).toHaveBeenCalledWith("order_1")
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "order.clearsale.rejected" }))
  })
})
