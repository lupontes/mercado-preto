import { GET, PATCH } from "../route"

function makeReq(body?: unknown) {
  let rate = 10
  const service = {
    getCommissionRate: jest.fn(async () => rate),
    setCommissionRate: jest.fn(async (r: number) => { rate = r }),
  }
  return { req: { body, scope: { resolve: () => service } } as any, service }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("/admin/settings", () => {
  it("returns the commission rate", async () => {
    const { req } = makeReq()
    const res = makeRes()
    await GET(req, res)
    expect(res._body).toEqual({ settings: { commissionRate: 10 } })
  })

  it("saves a new rate", async () => {
    const { req, service } = makeReq({ commissionRate: 12 })
    const res = makeRes()
    await PATCH(req, res)
    expect(service.setCommissionRate).toHaveBeenCalledWith(12)
    expect((res._body as any).settings).toEqual({ commissionRate: 12 })
  })

  it.each([101, -1, "10"])("rejects %p without saving", async (commissionRate) => {
    const { req, service } = makeReq({ commissionRate })
    const res = makeRes()
    await PATCH(req, res)
    expect(res._status).toBe(400)
    expect(service.setCommissionRate).not.toHaveBeenCalled()
  })
})
