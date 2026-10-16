import { rateLimitKeyGenerator, sellerAuth } from "../middlewares"
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

describe("rateLimitKeyGenerator", () => {
  function makeIpReq(remoteAddress: string, xff?: string) {
    return {
      socket: { remoteAddress },
      headers: xff === undefined ? {} : { "x-forwarded-for": xff },
    } as any
  }

  it("keys a direct public client by its socket address", () => {
    expect(rateLimitKeyGenerator(makeIpReq("198.51.100.7"))).toBe("198.51.100.7")
  })

  it("ignores X-Forwarded-For sent by a public client, so it can't pick its own bucket", () => {
    expect(rateLimitKeyGenerator(makeIpReq("198.51.100.7", "203.0.113.1"))).toBe("198.51.100.7")
  })

  it("behind the proxy, uses the entry the proxy appended (the last one), not the client-supplied first one", () => {
    const req = makeIpReq("172.18.0.5", "203.0.113.1, 198.51.100.7")
    expect(rateLimitKeyGenerator(req)).toBe("198.51.100.7")
  })

  it("treats IPv4-mapped IPv6 socket addresses from the proxy as trusted", () => {
    const req = makeIpReq("::ffff:172.18.0.5", "198.51.100.7")
    expect(rateLimitKeyGenerator(req)).toBe("198.51.100.7")
  })

  it("falls back to the socket address when the proxy sends no usable X-Forwarded-For", () => {
    expect(rateLimitKeyGenerator(makeIpReq("172.18.0.1"))).toBe("172.18.0.1")
    expect(rateLimitKeyGenerator(makeIpReq("172.18.0.1", "not-an-ip"))).toBe("172.18.0.1")
  })

  it("groups IPv6 clients by subnet so rotating addresses within it doesn't reset the limit", () => {
    const a = rateLimitKeyGenerator(makeIpReq("2001:db8:1234:5601::1"))
    const b = rateLimitKeyGenerator(makeIpReq("2001:db8:1234:56ff::abcd"))
    expect(a).toBe(b)
    expect(rateLimitKeyGenerator(makeIpReq("2001:db8:9999::1"))).not.toBe(a)
  })
})
