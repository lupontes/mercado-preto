/**
 * Medusa's store product query config has no `allowed` list, so through the
 * seller↔product link anyone with the publishable key could ask for any seller
 * column (CPF/CNPJ, e-mail, address, password hash). Only the fields the
 * storefront actually shows are public; everything else is rejected loudly so
 * a new storefront need is a deliberate change here.
 */
export const PUBLIC_SELLER_FIELDS: ReadonlySet<string> = new Set(["id", "name", "phone"])

const SELLER_SEGMENT = /seller/i

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out))
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out))
}

function isAllowedToken(token: string): boolean {
  // Medusa prefixes: "+" adds, "-" removes, "*" expands a whole relation.
  const prefix = token.match(/^[+\-*]*/)![0]
  const segments = token.slice(prefix.length).split(".")
  const sellerIndex = segments.findIndex((s) => SELLER_SEGMENT.test(s))
  if (sellerIndex === -1) return true
  if (prefix.includes("*")) return false
  // Exactly "<...>.seller.<public field>" — no deeper relation, no wildcard.
  return (
    segments[sellerIndex] === "seller" &&
    sellerIndex === segments.length - 2 &&
    PUBLIC_SELLER_FIELDS.has(segments[sellerIndex + 1])
  )
}

/** Returns the first `fields` token that would expose a non-public seller field, or null. */
export function findForbiddenSellerField(fields: unknown): string | null {
  const values: string[] = []
  collectStrings(fields, values)
  for (const value of values) {
    for (const raw of value.split(",")) {
      const token = raw.trim()
      if (token && !isAllowedToken(token)) return token
    }
  }
  return null
}
