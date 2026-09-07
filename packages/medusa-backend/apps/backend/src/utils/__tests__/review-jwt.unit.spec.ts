import { createReviewToken, verifyReviewToken } from "../review-jwt"

describe("review-jwt", () => {
  const original = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret"
  })

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original
  })

  it("round-trips orderId through create + verify", () => {
    const token = createReviewToken("order_1")

    const payload = verifyReviewToken(token)

    expect(payload.orderId).toBe("order_1")
    expect(payload.type).toBe("review")
  })

  it("throws on a token with the wrong number of segments", () => {
    expect(() => verifyReviewToken("not-a-real-token")).toThrow("Invalid token format")
  })

  it("throws when the signature was tampered with", () => {
    const token = createReviewToken("order_1")
    const [header, body] = token.split(".")
    const tampered = `${header}.${body}.deadbeef`

    expect(() => verifyReviewToken(tampered)).toThrow("Invalid token signature")
  })

  it("throws when the token is expired", () => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(
      JSON.stringify({ orderId: "order_1", type: "review", iat: now - 1000, exp: now - 1 })
    ).toString("base64url")
    const crypto = require("crypto")
    const sig = crypto.createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url")
    const expiredToken = `${header}.${body}.${sig}`

    expect(() => verifyReviewToken(expiredToken)).toThrow("Token expired")
  })

  it("throws when the token type isn't review", () => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(
      JSON.stringify({ orderId: "order_1", type: "seller", iat: now, exp: now + 3600 })
    ).toString("base64url")
    const crypto = require("crypto")
    const sig = crypto.createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url")
    const wrongTypeToken = `${header}.${body}.${sig}`

    expect(() => verifyReviewToken(wrongTypeToken)).toThrow("Invalid token type")
  })
})
