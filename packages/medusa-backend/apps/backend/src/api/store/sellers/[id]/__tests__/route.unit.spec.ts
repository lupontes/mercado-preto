import { GET } from "../route"

const stored = (status: string) => ({
  id: "seller_1", name: "Loja", bio: "Bio", location: "Salvador", category: "moda", status,
  email: "loja@example.com", cpfCnpj: "52998224725", passwordHash: "salt:hash",
})

function makeReq(seller: unknown) {
  const listSellers = jest.fn().mockResolvedValue(seller ? [seller] : [])
  return { params: { id: "seller_1" }, scope: { resolve: () => ({ listSellers }) } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /store/sellers/:id", () => {
  it.each(["pending", "approved", "suspended"])("hides a %s store", async (status) => {
    const res = makeRes()
    await GET(makeReq(stored(status)), res)

    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: "Vendedor não encontrado" })
  })

  it("shows an active store with public fields only", async () => {
    const res = makeRes()
    await GET(makeReq(stored("active")), res)

    expect(res._status).toBe(200)
    expect((res._body as any).seller).toMatchObject({ id: "seller_1", name: "Loja" })
    expect(JSON.stringify(res._body)).not.toMatch(/loja@example\.com|52998224725|salt:hash/)
  })
})
