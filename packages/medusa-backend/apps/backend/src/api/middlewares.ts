import { defineMiddlewares } from "@medusajs/framework/http"
import rateLimit, { ipKeyGenerator } from "express-rate-limit"
import { parseCookie, SELLER_SESSION_COOKIE } from "../utils/cookies"
import { verifySellerToken } from "../utils/seller-jwt"
import { clientIp } from "../utils/client-ip"
import { findForbiddenProductField, findForbiddenSellerField } from "../utils/store-fields-guard"
import { sellerImageUpload } from "./seller/uploads/upload-middlewares"

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
  // originalUrl, not req.path: for a `/store/*` mount Express strips the matched
  // prefix from req.path, so it cannot be trusted to identify the route here.
  const pathname = String(req.originalUrl ?? `${req.baseUrl ?? ""}${req.path ?? ""}`).split("?")[0]
  const isProductRoute = pathname === "/store/products" || pathname.startsWith("/store/products/")
  const forbidden =
    findForbiddenSellerField(req.query?.fields) ??
    (isProductRoute ? findForbiddenProductField(req.query?.fields) : null)
  if (forbidden) {
    return res.status(400).json({ error: `Campo não permitido: ${forbidden}` })
  }
  next()
}

// The key is the real client address (see utils/client-ip.ts); using an
// earlier X-Forwarded-For entry would let anyone reset their limit.
export const rateLimitKeyGenerator = (req: any): string => {
  const ip = clientIp(req)
  if (!ip) return "unknown"
  // Groups IPv6 clients by subnet, since a single client usually controls a
  // whole prefix and could otherwise rotate addresses to dodge the limit.
  return ipKeyGenerator(ip)
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

// Keyed by seller so one account cannot fill the uploads volume; the IP is
// only a fallback for requests that somehow lack a seller.
export const sellerUploadRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: { error: "Muitos envios em pouco tempo. Aguarde alguns minutos." },
  keyGenerator: (req: any) => req.sellerId ?? rateLimitKeyGenerator(req),
})

// Each code request sends an e-mail and each check is a guess at a 6-digit code.
export const loyaltyCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
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
      // Medusa registers the "/seller" auth above before this child route, so
      // multer never reads the body of an unauthenticated request.
      matcher: "/seller/uploads",
      methods: ["POST"],
      middlewares: [sellerUploadRateLimit, sellerImageUpload],
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
      matcher: "/store/loyalty/*",
      middlewares: [loyaltyCodeRateLimit],
    },
    {
      matcher: "/store/shipping/quote",
      middlewares: [shippingQuoteRateLimit],
    },
    {
      matcher: "/store/sellers/logout",
      middlewares: [sellerCors],
    },
    {
      // The Melhor Envio signature is an HMAC of the exact bytes received.
      matcher: "/webhooks/melhor-envio",
      methods: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
  ],
})
