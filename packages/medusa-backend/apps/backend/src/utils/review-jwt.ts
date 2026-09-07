import crypto from "crypto"

export type ReviewTokenPayload = {
  orderId: string
  type: "review"
  iat: number
  exp: number
}

export function createReviewToken(orderId: string): string {
  const secret = process.env.JWT_SECRET || "supersecret"
  const now = Math.floor(Date.now() / 1000)
  const payload: ReviewTokenPayload = {
    orderId,
    type: "review",
    iat: now,
    exp: now + 60 * 60 * 24 * 30, // 30 dias
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${sig}`
}

export function verifyReviewToken(token: string): ReviewTokenPayload {
  const secret = process.env.JWT_SECRET || "supersecret"
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Invalid token format")
  const [header, body, sig] = parts
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  if (sig !== expected) throw new Error("Invalid token signature")
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ReviewTokenPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired")
  if (payload.type !== "review") throw new Error("Invalid token type")
  return payload
}
