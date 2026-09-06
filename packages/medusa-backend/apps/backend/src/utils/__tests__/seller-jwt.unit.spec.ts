import { createSellerToken, verifySellerToken } from "../seller-jwt"

describe("seller-jwt", () => {
  const original = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret"
  })

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original
  })

  it("round-trips sellerId and email through create + verify", () => {
    const token = createSellerToken("seller_1", "loja@teste.com")

    const payload = verifySellerToken(token)

    expect(payload.sellerId).toBe("seller_1")
    expect(payload.email).toBe("loja@teste.com")
    expect(payload.type).toBe("seller")
  })

  it("still round-trips when JWT_SECRET is unset, via the same fallback on both sides", () => {
    delete process.env.JWT_SECRET

    const token = createSellerToken("seller_1", "loja@teste.com")
    const payload = verifySellerToken(token)

    expect(payload.sellerId).toBe("seller_1")
  })

  it("throws on a token with the wrong number of segments", () => {
    expect(() => verifySellerToken("not-a-real-token")).toThrow("Invalid token format")
  })

  it("throws when the signature was tampered with", () => {
    const token = createSellerToken("seller_1", "loja@teste.com")
    const [header, body] = token.split(".")
    const tampered = `${header}.${body}.deadbeef`

    expect(() => verifySellerToken(tampered)).toThrow("Invalid token signature")
  })

  it("throws when the token was signed with a different secret", () => {
    const token = createSellerToken("seller_1", "loja@teste.com")
    process.env.JWT_SECRET = "a-different-secret"

    expect(() => verifySellerToken(token)).toThrow("Invalid token signature")
  })

  it("throws when the token is expired", () => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(
      JSON.stringify({ sellerId: "seller_1", email: "loja@teste.com", type: "seller", iat: now - 1000, exp: now - 1 })
    ).toString("base64url")
    const crypto = require("crypto")
    const sig = crypto.createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url")
    const expiredToken = `${header}.${body}.${sig}`

    expect(() => verifySellerToken(expiredToken)).toThrow("Token expired")
  })

  it("throws when the token type isn't seller", () => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(
      JSON.stringify({ sellerId: "seller_1", email: "loja@teste.com", type: "admin", iat: now, exp: now + 3600 })
    ).toString("base64url")
    const crypto = require("crypto")
    const sig = crypto.createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url")
    const wrongTypeToken = `${header}.${body}.${sig}`

    expect(() => verifySellerToken(wrongTypeToken)).toThrow("Invalid token type")
  })
})
