import { GET } from "../route"

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

describe("GET /admin/payouts/preview", () => {
  it("returns 400 when seller_id is missing", async () => {
    const req = { query: {}, scope: makeScope({ payout: {}, commission: {} }) } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._status).toBe(400)
  })

  it("calculates the amount for an explicit period without suggesting one", async () => {
    const listPayouts = jest.fn()
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 1500, commissionCount: 2 })
    const req = {
      query: {
        seller_id: "seller_1",
        period_start: "2026-07-01T00:00:00.000Z",
        period_end: "2026-07-10T00:00:00.000Z",
      },
      scope: makeScope({
        payout: { listPayouts },
        commission: { sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listPayouts).not.toHaveBeenCalled()
    expect(sumUnlinkedPendingInPeriod).toHaveBeenCalledWith(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T00:00:00.000Z")
    )
    expect(res._body).toEqual({
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-10T00:00:00.000Z",
      amount: 1500,
      commissionCount: 2,
    })
  })

  it("suggests the period since the last completed payout when one exists", async () => {
    const listPayouts = jest.fn().mockResolvedValue([
      { id: "payout_1", periodEnd: "2026-06-15T00:00:00.000Z" },
    ])
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 900, commissionCount: 1 })
    const req = {
      query: { seller_id: "seller_1" },
      scope: makeScope({
        payout: { listPayouts },
        commission: { sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listPayouts).toHaveBeenCalledWith(
      { sellerId: "seller_1", status: "completed" },
      { order: { periodEnd: "DESC" }, take: 1 }
    )
    expect(res._body.periodStart).toBe("2026-06-15T00:00:00.000Z")
    expect(res._body.amount).toBe(900)
  })

  it("suggests the period since the earliest pending commission when there is no completed payout", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const listCommissions = jest.fn().mockResolvedValue([
      { id: "comm_1", created_at: "2026-06-20T00:00:00.000Z" },
    ])
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 300, commissionCount: 1 })
    const req = {
      query: { seller_id: "seller_1" },
      scope: makeScope({
        payout: { listPayouts },
        commission: { listCommissions, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listCommissions).toHaveBeenCalledWith(
      { sellerId: "seller_1", status: "pending", payoutId: null },
      { order: { created_at: "ASC" }, take: 1 }
    )
    expect(res._body.periodStart).toBe("2026-06-20T00:00:00.000Z")
  })

  it("suggests a zero-length period when the seller has neither a completed payout nor a pending commission", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const listCommissions = jest.fn().mockResolvedValue([])
    const sumUnlinkedPendingInPeriod = jest.fn().mockResolvedValue({ amount: 0, commissionCount: 0 })
    const req = {
      query: { seller_id: "seller_1" },
      scope: makeScope({
        payout: { listPayouts },
        commission: { listCommissions, sumUnlinkedPendingInPeriod },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.periodStart).toBe(res._body.periodEnd)
    expect(res._body.amount).toBe(0)
  })
})
