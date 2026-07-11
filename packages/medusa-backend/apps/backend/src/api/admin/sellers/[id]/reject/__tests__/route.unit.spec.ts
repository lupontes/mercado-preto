import { POST } from "../route"

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

describe("POST /admin/sellers/:id/reject", () => {
  it("rejects a pending seller with the given reason", async () => {
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", status: "pending" }])
    const rejectSeller = jest.fn().mockResolvedValue({ id: "seller_1", status: "pending", rejectionReason: "CNPJ inválido" })
    const req = {
      params: { id: "seller_1" },
      body: { reason: "CNPJ inválido" },
      scope: makeScope({ seller: { listSellers, rejectSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(rejectSeller).toHaveBeenCalledWith("seller_1", "CNPJ inválido")
    expect(res._status).toBe(200)
    expect(res._body).toEqual({ seller: { id: "seller_1", status: "pending", rejectionReason: "CNPJ inválido" } })
  })

  it("returns 400 and does not call rejectSeller when reason is missing", async () => {
    const listSellers = jest.fn()
    const rejectSeller = jest.fn()
    const req = {
      params: { id: "seller_1" },
      body: {},
      scope: makeScope({ seller: { listSellers, rejectSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(rejectSeller).not.toHaveBeenCalled()
  })

  it("returns 404 when the seller does not exist", async () => {
    const listSellers = jest.fn().mockResolvedValue([])
    const rejectSeller = jest.fn()
    const req = {
      params: { id: "seller_missing" },
      body: { reason: "CNPJ inválido" },
      scope: makeScope({ seller: { listSellers, rejectSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: "Vendedor não encontrado" })
    expect(rejectSeller).not.toHaveBeenCalled()
  })
})
