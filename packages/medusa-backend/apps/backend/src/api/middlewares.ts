import { defineMiddlewares } from "@medusajs/framework/http"
import rateLimit from "express-rate-limit"
import { parseCookie, SELLER_SESSION_COOKIE } from "../utils/cookies"
import { verifySellerToken } from "../utils/seller-jwt"
import { findForbiddenSellerField } from "../utils/store-fields-guard"

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

// Blocks private seller columns from being pulled through the seller↔product
// link with the public publishable key (see utils/store-fields-guard.ts).
export function storeFieldsGuard(req: any, res: any, next: any) {
  const forbidden = findForbiddenSellerField(req.query?.fields)
  if (forbidden) {
    return res.status(400).json({ error: `Campo não permitido: ${forbidden}` })
  }
  next()
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

// Each quote fans out to one paid Melhor Envio call per seller, so an open
// endpoint is an easy way to burn the marketplace's API quota.
export const shippingQuoteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  message: { error: "Muitas cotações de frete. Aguarde um minuto e tente novamente." },
  keyGenerator: rateLimitKeyGenerator,
})

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/*",
      middlewares: [storeFieldsGuard],
    },
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
      matcher: "/store/shipping/quote",
      middlewares: [shippingQuoteRateLimit],
    },
    {
      matcher: "/store/sellers/logout",
      middlewares: [sellerCors],
    },
  ],
})
