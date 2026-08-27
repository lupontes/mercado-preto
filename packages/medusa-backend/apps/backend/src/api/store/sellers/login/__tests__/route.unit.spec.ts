import { POST } from "../route"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown, _headers: {} as Record<string, string> } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.setHeader = (name: string, value: string) => { res._headers[name] = value; return res }
  return res
}

describe("POST /store/sellers/login", () => {
  it("sets the session as an HttpOnly cookie and never returns the token in the body", async () => {
    const passwordHash = SellerModuleService.hashPassword("secret123")
    const seller = { id: "seller_1", email: "loja@teste.com", name: "Loja Teste", status: "approved", passwordHash }
    const listSellers = jest.fn().mockResolvedValue([seller])
    const req = {
      body: { email: "loja@teste.com", password: "secret123" },
      scope: makeScope({ [SELLER_MODULE]: { listSellers } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._body).toEqual({
      seller: { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" },
    })
    expect(res._headers["Set-Cookie"]).toContain("seller_session=")
    expect(res._headers["Set-Cookie"]).toContain("HttpOnly")
    expect(res._headers["Set-Cookie"]).toContain("SameSite=Strict")
  })

  it("returns 401 without setting a cookie when the password is wrong", async () => {
    const passwordHash = SellerModuleService.hashPassword("secret123")
    const seller = { id: "seller_1", email: "loja@teste.com", name: "Loja Teste", status: "approved", passwordHash }
    const listSellers = jest.fn().mockResolvedValue([seller])
    const req = {
      body: { email: "loja@teste.com", password: "wrong-password" },
      scope: makeScope({ [SELLER_MODULE]: { listSellers } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(401)
    expect(res._headers["Set-Cookie"]).toBeUndefined()
  })
})
