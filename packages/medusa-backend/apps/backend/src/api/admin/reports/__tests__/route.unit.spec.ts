import { GET } from "../route"

const commission = (sellerId: string, createdAt: string, gross = 1000) => ({
  sellerId, created_at: createdAt, grossAmount: gross, commissionAmount: gross / 10,
})
const payout = (sellerId: string, createdAt: string, status: string, amount = 500) => ({ sellerId, created_at: createdAt, status, amount })

function makeReq(query: Record<string, string>, data: { commissions?: unknown[]; payouts?: unknown[] } = {}) {
  const services: Record<string, unknown> = {
    commission: { listCommissions: jest.fn().mockResolvedValue(data.commissions ?? []) },
    payout: { listPayouts: jest.fn().mockResolvedValue(data.payouts ?? []) },
    seller: { listSellers: jest.fn().mockResolvedValue([{ id: "s1", name: "Loja A" }, { id: "s2", name: "Loja B" }]) },
  }
  return { query, scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /admin/reports", () => {
  it("includes the whole last day when period_end is a date", async () => {
    const res = makeRes()
    await GET(makeReq({ period_start: "2026-10-01", period_end: "2026-10-31" }, {
      commissions: [commission("s1", "2026-10-31T15:00:00Z"), commission("s1", "2026-11-01T00:00:01Z")],
    }), res)

    expect((res._body as any).summary.orderCount).toBe(1)
  })

  it("respects an exact time when period_end has one", async () => {
    const res = makeRes()
    await GET(makeReq({ period_start: "2026-10-01", period_end: "2026-10-31T12:00:00.000Z" }, {
      commissions: [commission("s1", "2026-10-31T15:00:00Z")],
    }), res)

    expect((res._body as any).summary.orderCount).toBe(0)
  })

  it.each([
    [{ period_start: "abc" }],
    [{ period_end: "2026-13-45" }],
    [{ period_start: "2026-11-01", period_end: "2026-10-01" }],
  ])("rejects an invalid period %p", async (query) => {
    const res = makeRes()
    await GET(makeReq(query), res)

    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Período inválido" })
  })

  it("sums only the period, per seller", async () => {
    const res = makeRes()
    await GET(makeReq({ period_start: "2026-10-01", period_end: "2026-10-31" }, {
      commissions: [
        commission("s1", "2026-10-05T10:00:00Z", 1000),
        commission("s2", "2026-10-06T10:00:00Z", 2000),
        commission("s1", "2026-09-30T23:00:00Z", 9999),
      ],
      payouts: [
        payout("s1", "2026-10-10T10:00:00Z", "completed", 900),
        payout("s2", "2026-10-11T10:00:00Z", "pending", 1800),
      ],
    }), res)

    const body = res._body as any
    expect(body.summary).toMatchObject({ totalGmv: 3000, totalCommission: 300, totalPayouts: 900, pendingPayouts: 1800, orderCount: 2, activeSellers: 2 })
    expect(body.sellers.find((s: any) => s.sellerId === "s1")).toMatchObject({ gmv: 1000, payouts: 900, orderCount: 1 })
  })
})
