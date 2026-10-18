import crypto from "crypto"
import { LOYALTY_TOKEN_TTL_SECONDS } from "../modules/loyalty/constants"

// Proof that the buyer confirmed the e-mailed code for this document. Short
// lived and scoped, so a seller session token can never be used in its place.
type LoyaltyTokenPayload = { scope: "loyalty"; document: string; exp: number }

function secret(): string {
  return process.env.JWT_SECRET || "supersecret"
}

function sign(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url")
}

export function signLoyaltyToken(document: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload: LoyaltyTokenPayload = {
    scope: "loyalty",
    document,
    exp: Math.floor(Date.now() / 1000) + LOYALTY_TOKEN_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.${sign(`${header}.${body}`)}`
}

export function verifyLoyaltyToken(token: string): { document: string } | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = Buffer.from(sign(`${header}.${body}`))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<LoyaltyTokenPayload>
    if (payload.scope !== "loyalty" || typeof payload.document !== "string") return null
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return { document: payload.document }
  } catch {
    return null
  }
}
