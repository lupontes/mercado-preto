export const SELLER_SESSION_COOKIE = "seller_session"
export const SELLER_SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days, matches the JWT's exp

export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

export function buildSetCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  options?: { secure?: boolean }
): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (options?.secure) attrs.push("Secure")
  return attrs.join("; ")
}

export function buildClearCookie(name: string, options?: { secure?: boolean }): string {
  return buildSetCookie(name, "", 0, options)
}
