import crypto from "crypto"
import { signLoyaltyToken, verifyLoyaltyToken } from "../loyalty-token"
import { createSellerToken } from "../seller-jwt"

describe("loyalty token", () => {
  const original = process.env.JWT_SECRET
  beforeEach(() => { process.env.JWT_SECRET = "test-secret" })
  afterAll(() => { process.env.JWT_SECRET = original })

  it("round-trips the document", () => {
    expect(verifyLoyaltyToken(signLoyaltyToken("52998224725"))).toEqual({ document: "52998224725" })
  })

  it("rejects a tampered token", () => {
    const [h, b, s] = signLoyaltyToken("52998224725").split(".")
    const forged = Buffer.from(JSON.stringify({ scope: "loyalty", document: "11111111111", exp: 9999999999 })).toString("base64url")
    expect(verifyLoyaltyToken(`${h}.${forged}.${s}`)).toBeNull()
    expect(verifyLoyaltyToken(`${h}.${b}`)).toBeNull()
  })

  it("rejects an expired token", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-18T10:00:00Z"))
    const token = signLoyaltyToken("52998224725")
    jest.setSystemTime(new Date("2026-10-18T10:31:00Z"))
    expect(verifyLoyaltyToken(token)).toBeNull()
    jest.useRealTimers()
  })

  it("rejects a seller session token", () => {
    expect(verifyLoyaltyToken(createSellerToken("seller_1", "a@b.com"))).toBeNull()
  })

  it("rejects a token signed with another secret", () => {
    const token = signLoyaltyToken("52998224725")
    process.env.JWT_SECRET = "other"
    expect(verifyLoyaltyToken(token)).toBeNull()
    expect(crypto).toBeDefined()
  })
})
