import { sellerAuth } from "../middlewares"
import { createSellerToken } from "../../utils/seller-jwt"

function makeReq(cookieHeader?: string) {
  return { headers: { cookie: cookieHeader } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("sellerAuth", () => {
  it("populates req.sellerId/req.sellerEmail from a valid session cookie and calls next()", () => {
    const token = createSellerToken("seller_1", "loja@teste.com")
    const req = makeReq(`seller_session=${encodeURIComponent(token)}`)
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(req.sellerId).toBe("seller_1")
    expect(req.sellerEmail).toBe("loja@teste.com")
    expect(next).toHaveBeenCalled()
  })

  it("rejects when the cookie header has no seller_session cookie", () => {
    const req = makeReq(undefined)
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body).toEqual({ error: "Token do vendedor obrigatório" })
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects a malformed cookie value", () => {
    const req = makeReq("seller_session=not-a-real-token")
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body).toEqual({ error: "Token inválido ou expirado" })
    expect(next).not.toHaveBeenCalled()
  })

  it("ignores unrelated cookies and still requires seller_session", () => {
    const req = makeReq("other_cookie=abc; another=def")
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
