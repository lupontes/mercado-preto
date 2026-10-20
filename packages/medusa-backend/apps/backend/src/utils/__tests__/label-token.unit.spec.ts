import crypto from "crypto"
import { signLoyaltyToken } from "../loyalty-token"
import { labelLink, LABEL_LINK_TTL_SECONDS, signLabelToken, verifyLabelToken } from "../label-token"

describe("label-token", () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret"
    process.env.BACKEND_URL = "https://teste.example.com/api"
  })
  afterAll(() => { process.env = originalEnv })

  it("round-trips the order id", () => {
    expect(verifyLabelToken(signLabelToken("order_1"))).toEqual({ orderId: "order_1" })
  })

  it("rejects a loyalty token (scope mismatch)", () => {
    expect(verifyLabelToken(signLoyaltyToken("12345678900"))).toBeNull()
  })

  it("rejects a correctly signed token with another scope", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(JSON.stringify({ scope: "seller", orderId: "order_1", exp: 9999999999 })).toString("base64url")
    const sig = crypto.createHmac("sha256", "test-secret").update(`${header}.${body}`).digest("base64url")
    expect(verifyLabelToken(`${header}.${body}.${sig}`)).toBeNull()
  })

  it("rejects an expired token", () => {
    const past = new Date(Date.now() - (LABEL_LINK_TTL_SECONDS + 60) * 1000)
    expect(verifyLabelToken(signLabelToken("order_1", past))).toBeNull()
  })

  it("rejects a tampered signature and malformed input", () => {
    const token = signLabelToken("order_1")
    const [h, b] = token.split(".")
    expect(verifyLabelToken(`${h}.${b}.AAAA`)).toBeNull()
    expect(verifyLabelToken("garbage")).toBeNull()
  })

  it("rejects a token signed with a different secret", () => {
    const token = signLabelToken("order_1")
    process.env.JWT_SECRET = "other-secret"
    expect(verifyLabelToken(token)).toBeNull()
  })

  it("does not fall back to a known secret in production", () => {
    delete process.env.JWT_SECRET
    process.env.NODE_ENV = "production"
    expect(() => signLabelToken("order_1")).toThrow()
    expect(verifyLabelToken("a.b.c")).toBeNull()
    process.env.NODE_ENV = originalEnv.NODE_ENV
  })

  it("builds the public link under BACKEND_URL", () => {
    const link = labelLink("order_1")
    expect(link.startsWith("https://teste.example.com/api/labels/")).toBe(true)
    const token = link.split("/labels/")[1]
    expect(verifyLabelToken(token)).toEqual({ orderId: "order_1" })
  })
})
