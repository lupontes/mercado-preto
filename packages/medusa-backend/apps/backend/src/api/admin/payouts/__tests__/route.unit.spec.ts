import { GET, POST } from "../route"

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

describe("GET /admin/payouts", () => {
  it("enriches each payout with the seller's name", async () => {
    const payout = { id: "payout_1", sellerId: "seller_1", amount: 10000 }
    const listPayouts = jest.fn()
      .mockResolvedValueOnce([payout])
      .mockResolvedValueOnce([payout])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: {},
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listSellers).toHaveBeenCalledWith({ id: ["seller_1"] })
    expect(res._body.payouts[0].sellerName).toBe("Loja Teste")
  })

  it("falls back to a placeholder name when the seller no longer exists", async () => {
    const payout = { id: "payout_1", sellerId: "seller_deleted", amount: 10000 }
    const listPayouts = jest.fn()
      .mockResolvedValueOnce([payout])
      .mockResolvedValueOnce([payout])
    const listSellers = jest.fn().mockResolvedValue([])
    const req = {
      query: {},
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.payouts[0].sellerName).toBe("Vendedor removido")
  })

  it("returns the real total and count, not just the current page", async () => {
    const p1 = { id: "payout_1", sellerId: "seller_1", amount: 10000 }
    const p2 = { id: "payout_2", sellerId: "seller_1", amount: 5000 }
    const p3 = { id: "payout_3", sellerId: "seller_1", amount: 5000 }
    const listPayouts = jest.fn()
      .mockResolvedValueOnce([p1])
      .mockResolvedValueOnce([p1, p2, p3])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: { limit: "1" },
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.count).toBe(3)
    expect(res._body.total).toBe(20000)
  })
})

describe("POST /admin/payouts", () => {
  it("creates the payout and links pending commissions in the period", async () => {
    const createPayouts = jest.fn().mockResolvedValue({ id: "payout_1", sellerId: "seller_1" })
    const linkPendingToPayout = jest.fn().mockResolvedValue(undefined)
    const req = {
      body: {
        sellerId: "seller_1",
        amount: 10000,
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-10T00:00:00.000Z",
      },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(createPayouts).toHaveBeenCalled()
    expect(linkPendingToPayout).toHaveBeenCalledWith(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T00:00:00.000Z"),
      "payout_1"
    )
    expect(res._status).toBe(201)
  })

  it("returns 400 and does not create a payout or link commissions when body is invalid", async () => {
    const createPayouts = jest.fn()
    const linkPendingToPayout = jest.fn()
    const req = {
      body: { sellerId: "seller_1" },
      scope: makeScope({
        payout: { createPayouts },
        commission: { linkPendingToPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(createPayouts).not.toHaveBeenCalled()
    expect(linkPendingToPayout).not.toHaveBeenCalled()
  })
})
