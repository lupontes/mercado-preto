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

function forEachToken(fields: unknown, visit: (token: string) => string | null): string | null {
  const values: string[] = []
  collectStrings(fields, values)
  for (const value of values) {
    for (const raw of value.split(",")) {
      const token = raw.trim()
      const hit = token ? visit(token) : null
      if (hit) return hit
    }
  }
  return null
}

/**
 * Product `metadata` holds the seller's pending, unreviewed edits, so the
 * public API must never return it. Rejects a first segment of `metadata` under
 * any prefix (`-metadata` is harmless but rejected too, to keep the rule
 * simple) and a bare `*`, which would expand every product column. Nested
 * `variants.metadata` is out of scope: variants hold no pending edits.
 */
export function findForbiddenProductField(fields: unknown): string | null {
  return forEachToken(fields, (token) => {
    const rest = token.replace(/^[+\-*]*/, "")
    return rest === "" || rest.split(".")[0] === "metadata" ? token : null
  })
}

const PRODUCT_SEGMENT = /^products?$/i

/**
 * Store query configs have no `allowed` list, so any route can reach a product
 * through a relation (`variants.product`, `items.product`, `categories.products`)
 * and pull its `metadata`, where the seller's pending, unreviewed edits live.
 * Rejected on every `/store/*` route:
 * - `metadata` or `*` right after a product segment, at any depth;
 * - a `*` expansion ending in a product relation, which selects every product
 *   column (metadata included, now or if Medusa ever adds it to the defaults);
 * - any `products` segment: product lists reached from another entity skip the
 *   `published` filter of `/store/products`, so they would show products still
 *   under review. The storefront never asks for them.
 * `variants.metadata` stays allowed: variants hold no pending edits.
 */
export function findForbiddenProductRelationField(fields: unknown): string | null {
  return forEachToken(fields, (token) => {
    const prefix = token.match(/^[+\-*]*/)![0]
    const segments = token.slice(prefix.length).split(".")
    const last = segments[segments.length - 1]
    if (prefix.includes("*") && PRODUCT_SEGMENT.test(last)) return token
    for (let i = 0; i < segments.length; i++) {
      if (!PRODUCT_SEGMENT.test(segments[i])) continue
      if (/^products$/i.test(segments[i])) return token
      const next = segments[i + 1]
      if (next !== undefined && (next === "*" || /^metadata$/i.test(next))) return token
    }
    return null
  })
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
