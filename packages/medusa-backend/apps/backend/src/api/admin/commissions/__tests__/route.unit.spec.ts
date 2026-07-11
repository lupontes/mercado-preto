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

const baseCommission = {
  id: "comm_1",
  sellerId: "seller_1",
  grossAmount: 10000,
  commissionAmount: 1500,
  sellerPayout: 8500,
}

describe("GET /admin/commissions", () => {
  it("enriches each commission with the seller's name", async () => {
    const listCommissions = jest.fn()
      .mockResolvedValueOnce([baseCommission])
      .mockResolvedValueOnce([baseCommission])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: {},
      scope: makeScope({
        commission: { listCommissions },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listSellers).toHaveBeenCalledWith({ id: ["seller_1"] })
    expect(res._body.commissions[0].sellerName).toBe("Loja Teste")
  })

  it("falls back to a placeholder name when the seller no longer exists", async () => {
    const deletedSellerCommission = { ...baseCommission, sellerId: "seller_deleted" }
    const listCommissions = jest.fn()
      .mockResolvedValueOnce([deletedSellerCommission])
      .mockResolvedValueOnce([deletedSellerCommission])
    const listSellers = jest.fn().mockResolvedValue([])
    const req = {
      query: {},
      scope: makeScope({
        commission: { listCommissions },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.commissions[0].sellerName).toBe("Vendedor removido")
  })

  it("returns the real total count, not just the current page size", async () => {
    const commission2 = { ...baseCommission, id: "comm_2", grossAmount: 5000, commissionAmount: 750, sellerPayout: 4250 }
    const commission3 = { ...baseCommission, id: "comm_3", grossAmount: 5000, commissionAmount: 750, sellerPayout: 4250 }
    const listCommissions = jest.fn()
      .mockResolvedValueOnce([baseCommission])
      .mockResolvedValueOnce([baseCommission, commission2, commission3])
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", name: "Loja Teste" }])
    const req = {
      query: { limit: "1" },
      scope: makeScope({
        commission: { listCommissions },
        seller: { listSellers },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.count).toBe(3)
  })
})
