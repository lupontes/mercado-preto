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

describe("GET /admin/payouts/:id", () => {
  it("returns 404 when the payout does not exist", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const req = {
      params: { id: "payout_missing" },
      scope: makeScope({ payout: { listPayouts }, seller: {}, commission: {} }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._status).toBe(404)
  })

  it("returns the payout enriched with seller banking data and linked commissions", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", sellerId: "seller_1", amount: 8200 }])
    const listSellers = jest.fn().mockResolvedValue([{
      id: "seller_1",
      name: "Mulheres de Axé do Brasil",
      bankName: "Banco do Brasil",
      bankAgency: "1234",
      bankAccount: "56789-0",
      bankAccountType: "checking",
      pixKey: "contato@mercadopreto.com.br",
      pixKeyType: "email",
    }])
    const listCommissions = jest.fn().mockResolvedValue([{ id: "comm_1", payoutId: "payout_1" }])
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
        commission: { listCommissions },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listSellers).toHaveBeenCalledWith({ id: "seller_1" })
    expect(listCommissions).toHaveBeenCalledWith({ payoutId: "payout_1" })
    expect(res._body.payout.sellerName).toBe("Mulheres de Axé do Brasil")
    expect(res._body.seller.pixKey).toBe("contato@mercadopreto.com.br")
    expect(res._body.commissions).toHaveLength(1)
  })

  it("falls back gracefully when the seller no longer exists", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", sellerId: "seller_deleted", amount: 100 }])
    const listSellers = jest.fn().mockResolvedValue([])
    const listCommissions = jest.fn().mockResolvedValue([])
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts },
        seller: { listSellers },
        commission: { listCommissions },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._body.payout.sellerName).toBe("Vendedor removido")
    expect(res._body.seller).toBeNull()
  })
})
