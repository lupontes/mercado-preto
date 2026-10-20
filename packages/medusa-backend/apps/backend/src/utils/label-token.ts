import crypto from "crypto"

// The seller prints the label days after the sale, so the link outlives the
// short-lived loyalty token; the print URL itself is always fetched fresh.
export const LABEL_LINK_TTL_SECONDS = 30 * 24 * 60 * 60

// Scoped so no other signed token (loyalty, seller session) opens a label.
type LabelTokenPayload = { scope: "label"; orderId: string; exp: number }

// Production never falls back to a known secret: anyone could forge links.
function secret(): string {
  const value = process.env.JWT_SECRET
  if (value) return value
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET não configurado")
  return "supersecret"
}

function sign(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url")
}

export function signLabelToken(orderId: string, now: Date = new Date()): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload: LabelTokenPayload = {
    scope: "label",
    orderId,
    exp: Math.floor(now.getTime() / 1000) + LABEL_LINK_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.${sign(`${header}.${body}`)}`
}

export function verifyLabelToken(token: string): { orderId: string } | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  let expected: Buffer
  try {
    expected = Buffer.from(sign(`${header}.${body}`))
  } catch {
    return null
  }
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<LabelTokenPayload>
    if (payload.scope !== "label" || typeof payload.orderId !== "string") return null
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return { orderId: payload.orderId }
  } catch {
    return null
  }
}

export function labelLink(orderId: string): string {
  return `${process.env.BACKEND_URL}/labels/${signLabelToken(orderId)}`
}
