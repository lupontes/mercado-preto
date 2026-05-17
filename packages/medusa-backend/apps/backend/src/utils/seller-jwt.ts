import crypto from "crypto"

export type SellerTokenPayload = {
  sellerId: string
  email: string
  type: "seller"
  iat: number
  exp: number
}

export function createSellerToken(sellerId: string, email: string): string {
  const secret = process.env.JWT_SECRET || "supersecret"
  const now = Math.floor(Date.now() / 1000)
  const payload: SellerTokenPayload = {
    sellerId,
    email,
    type: "seller",
    iat: now,
    exp: now + 60 * 60 * 24 * 7, // 7 days
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${sig}`
}

export function verifySellerToken(token: string): SellerTokenPayload {
  const secret = process.env.JWT_SECRET || "supersecret"
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Invalid token format")
  const [header, body, sig] = parts
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  if (sig !== expected) throw new Error("Invalid token signature")
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SellerTokenPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired")
  if (payload.type !== "seller") throw new Error("Invalid token type")
  return payload
}
