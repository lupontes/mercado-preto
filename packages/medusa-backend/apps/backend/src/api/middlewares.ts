import { defineMiddlewares } from "@medusajs/framework/http"
import { BlockList, isIP } from "node:net"
import rateLimit, { ipKeyGenerator } from "express-rate-limit"
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

// The only hop we trust to set X-Forwarded-For is our own nginx, which reaches
// the backend from the Docker network (or loopback). Anything else talks to the
// backend directly (port 9000 is exposed) and could forge the header.
const trustedProxies = new BlockList()
trustedProxies.addSubnet("127.0.0.0", 8, "ipv4")
trustedProxies.addSubnet("10.0.0.0", 8, "ipv4")
trustedProxies.addSubnet("172.16.0.0", 12, "ipv4")
trustedProxies.addSubnet("192.168.0.0", 16, "ipv4")
trustedProxies.addAddress("::1", "ipv6")
trustedProxies.addSubnet("fc00::", 7, "ipv6")

function normalizeIp(ip: string | undefined): string | undefined {
  const trimmed = ip?.trim()
  if (!trimmed) return undefined
  const unmapped = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed
  return isIP(unmapped) ? unmapped : undefined
}

function isTrustedProxy(ip: string): boolean {
  return trustedProxies.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6")
}

// Reads the socket address rather than req.ip, which depends on Express's
// "trust proxy" setting. Behind nginx the *last* X-Forwarded-For entry is the
// one nginx appended ($proxy_add_x_forwarded_for); earlier entries come from the
// client and were previously used as the key, letting anyone reset their limit.
export const rateLimitKeyGenerator = (req: any): string => {
  const peer = normalizeIp(req.socket?.remoteAddress)
  if (!peer) return "unknown"

  let clientIp = peer
  if (isTrustedProxy(peer)) {
    const xff = req.headers["x-forwarded-for"] as string | undefined
    clientIp = normalizeIp(xff?.split(",").at(-1)) ?? peer
  }

  // Groups IPv6 clients by subnet, since a single client usually controls a
  // whole prefix and could otherwise rotate addresses to dodge the limit.
  return ipKeyGenerator(clientIp)
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
