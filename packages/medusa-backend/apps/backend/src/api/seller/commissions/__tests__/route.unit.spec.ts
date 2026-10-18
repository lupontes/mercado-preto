import { GET } from "../route"

const commission = (n: number) => ({ id: `c${n}`, grossAmount: 1000, commissionAmount: 100, sellerPayout: 900 })
const all = Array.from({ length: 25 }, (_, i) => commission(i + 1))

function makeReq(query: Record<string, string> = {}) {
  const service = {
    listAndCountCommissions: jest.fn().mockResolvedValue([all.slice(0, 20), 25]),
    listCommissions: jest.fn().mockResolvedValue(all),
  }
  const req = { sellerId: "seller_1", query, scope: { resolve: () => service } } as any
  return { req, service }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /seller/commissions", () => {
  it("counts and totals every commission, not just the current page", async () => {
    const { req } = makeReq()
    const res = makeRes()
    await GET(req, res)

    const body = res._body as any
    expect(body.commissions).toHaveLength(20)
    expect(body.count).toBe(25)
    expect(body.totals).toEqual({ grossAmount: 25000, commissionAmount: 2500, sellerPayout: 22500 })
  })

  it("always filters by the session seller and honours the status filter", async () => {
    const { req, service } = makeReq({ status: "paid", limit: "5", offset: "10" })
    await GET(req, makeRes())

    expect(service.listAndCountCommissions).toHaveBeenCalledWith(
      { sellerId: "seller_1", status: "paid" },
      expect.objectContaining({ take: 5, skip: 10 })
    )
    expect(service.listCommissions).toHaveBeenCalledWith({ sellerId: "seller_1", status: "paid" })
  })
})
