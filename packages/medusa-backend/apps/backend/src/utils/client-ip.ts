import { BlockList, isIP } from "node:net"

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
// one nginx appended ($proxy_add_x_forwarded_for); earlier entries come from
// the client and can be forged.
export function clientIp(req: any): string | undefined {
  const peer = normalizeIp(req.socket?.remoteAddress)
  if (!peer) return undefined
  if (!isTrustedProxy(peer)) return peer
  const xff = req.headers?.["x-forwarded-for"] as string | undefined
  return normalizeIp(xff?.split(",").at(-1)) ?? peer
}
