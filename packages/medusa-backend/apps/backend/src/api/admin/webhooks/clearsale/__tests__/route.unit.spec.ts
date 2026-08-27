import { POST } from "../route"

function makeReq(secretHeader: string | undefined, body: any = {}) {
  return {
    headers: secretHeader !== undefined ? { "x-clearsale-secret": secretHeader } : {},
    body,
    scope: { resolve: () => ({}) },
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /admin/webhooks/clearsale", () => {
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
})
