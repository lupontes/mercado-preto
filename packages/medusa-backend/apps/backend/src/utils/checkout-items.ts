import type { CheckoutRequest } from "./checkout-payload"
import { CART_ITEM_UNAVAILABLE_MESSAGE } from "./shipping-quote"

export type PriceChange = { variantId: string; price: number; title: string }

export const PRICE_CHANGED_MESSAGE = "O preço de alguns produtos foi atualizado"

type ResolveResult =
  | { ok: true; items: CheckoutRequest["items"] }
  | { ok: false; status: 400 | 409; body: { error: string; priceChanges?: PriceChange[] } }

const unavailable = (): ResolveResult => ({
  ok: false,
  status: 400,
  body: { error: CART_ITEM_UNAVAILABLE_MESSAGE },
})

/**
 * Replaces the price and title the browser sent with the database values, so the
 * charged amount never depends on client input. A price mismatch answers 409 so the
 * buyer can confirm the new price; a missing variant or price answers 400 without
 * exposing internal ids.
 */
export async function resolveCheckoutItems(
  query: { graph: (args: any) => Promise<{ data: any[] }> },
  items: CheckoutRequest["items"]
): Promise<ResolveResult> {
  const variantIds = [...new Set(items.map((item) => item.variantId))]
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "prices.amount", "prices.currency_code", "product.title"],
    filters: { id: variantIds },
  })
  const variantById = new Map<string, any>(data.map((variant) => [variant.id, variant]))

  const resolved: CheckoutRequest["items"] = []
  const priceChanges: PriceChange[] = []
  const reported = new Set<string>()

  for (const item of items) {
    const variant = variantById.get(item.variantId)
    // Same rule as the storefront: first brl price wins. 0 is treated as unavailable.
    const price = variant?.prices?.find((p: any) => p.currency_code === "brl")?.amount
    if (!variant || !price) return unavailable()

    const title: string = variant.product?.title ?? item.title
    if (price !== item.price && !reported.has(item.variantId)) {
      reported.add(item.variantId)
      priceChanges.push({ variantId: item.variantId, price, title })
    }
    resolved.push({ ...item, price, title })
  }

  if (priceChanges.length > 0) {
    return { ok: false, status: 409, body: { error: PRICE_CHANGED_MESSAGE, priceChanges } }
  }
  return { ok: true, items: resolved }
}
