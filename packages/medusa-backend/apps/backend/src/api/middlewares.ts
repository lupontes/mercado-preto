import { defineMiddlewares } from "@medusajs/framework/http"
import rateLimit from "express-rate-limit"
import { parseCookie, SELLER_SESSION_COOKIE } from "../utils/cookies"
import { verifySellerToken } from "../utils/seller-jwt"

export function sellerCors(req: any, res: any, next: any) {
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

export function sellerAuth(req: any, res: any, next: any) {
  const token = parseCookie(req.headers.cookie, SELLER_SESSION_COOKIE)
  if (!token) {
    return res.status(401).json({ error: "Token do vendedor obrigatório" })
  }
  try {
    const payload = verifySellerToken(token)
    req.sellerId = payload.sellerId
    req.sellerEmail = payload.email
    next()
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" })
  }
}

const rateLimitKeyGenerator = (req: any) => {
  const xff = req.headers["x-forwarded-for"] as string | undefined
  return xff?.split(",")[0]?.trim() ?? req.ip ?? "unknown"
}

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
  keyGenerator: rateLimitKeyGenerator,
})

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
  keyGenerator: rateLimitKeyGenerator,
})

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
    {
      matcher: "/store/sellers/logout",
      middlewares: [sellerCors],
    },
  ],
})
