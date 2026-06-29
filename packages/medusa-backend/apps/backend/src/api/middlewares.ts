import crypto from "crypto"
import { defineMiddlewares } from "@medusajs/framework/http"

const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: any, res: any, next: any) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown"
    const now = Date.now()
    const entry = rateLimitStore.get(ip)

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs })
      return next()
    }

    entry.count++
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: "Muitas tentativas. Tente novamente mais tarde." })
    }
    next()
  }
}

function verifySellerToken(token: string) {
  const secret = process.env.JWT_SECRET!
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Invalid token format")
  const [header, body, sig] = parts
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  if (sig !== expected) throw new Error("Invalid signature")
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired")
  if (payload.type !== "seller") throw new Error("Invalid token type")
  return payload as { sellerId: string; email: string }
}

function sellerCors(req: any, res: any, next: any) {
  const origin = req.headers.origin as string | undefined
  const allowed = (process.env.STORE_CORS || "").split(",").map((s: string) => s.trim())
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization")
  }
  if (req.method === "OPTIONS") return res.status(200).end()
  next()
}

function sellerAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization as string | undefined
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token do vendedor obrigatório" })
  }
  try {
    const token = authHeader.slice(7)
    const payload = verifySellerToken(token)
    req.sellerId = payload.sellerId
    req.sellerEmail = payload.email
    next()
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" })
  }
}

const loginRateLimit = rateLimit(10, 15 * 60 * 1000)
const registerRateLimit = rateLimit(5, 60 * 60 * 1000)

export default defineMiddlewares({
  routes: [
    {
      matcher: "/seller",
      middlewares: [sellerCors, sellerAuth],
    },
    {
      matcher: "/store/sellers/login",
      middlewares: [loginRateLimit],
    },
    {
      matcher: "/store/sellers/register",
      middlewares: [registerRateLimit],
    },
    {
      matcher: "/store/sellers/set-password",
      middlewares: [loginRateLimit],
    },
  ],
})
