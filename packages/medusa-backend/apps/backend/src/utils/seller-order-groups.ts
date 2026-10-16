import type { SellerShipping } from "./shipping-quote"

export type PreferenceItem = {
  title: string
  quantity: number
  price: number
  variantId: string
  productId: string
}

export type SellerGroup = {
  sellerId: string
  subtotal: number
  shippingShare: number
  // Absent on snapshots created before per-seller shipping (cycle 2).
  shipping?: Omit<SellerShipping, "sellerId" | "sellerName">
  items: Array<{ variant_id?: string; title: string; quantity: number; price: number }>
}

/**
 * One group per seller; each group's shipping is that seller's real quote.
 * Sellers are keyed by variant (resolved server-side, like the quote) — the
 * browser's productId is never trusted, or a tampered cart could pair one
 * seller's items with another seller's shipping.
 */
export function groupItemsBySeller(
  items: PreferenceItem[],
  sellerByVariantId: Record<string, string>,
  shippingBySeller: Record<string, SellerShipping>
): { groups: SellerGroup[] } | { unresolvedVariantId: string } {
  for (const item of items) {
    if (!sellerByVariantId[item.variantId]) return { unresolvedVariantId: item.variantId }
  }

  const order: string[] = []
  const bySeller = new Map<string, { subtotal: number; items: SellerGroup["items"] }>()
  for (const item of items) {
    const sellerId = sellerByVariantId[item.variantId]
    if (!bySeller.has(sellerId)) {
      bySeller.set(sellerId, { subtotal: 0, items: [] })
      order.push(sellerId)
    }
    const group = bySeller.get(sellerId)!
    group.subtotal += item.price * item.quantity
    group.items.push({ variant_id: item.variantId, title: item.title, quantity: item.quantity, price: item.price })
  }

  return {
    groups: order.map((sellerId) => {
      const s = shippingBySeller[sellerId]
      return {
        sellerId,
        subtotal: bySeller.get(sellerId)!.subtotal,
        shippingShare: s?.price ?? 0,
        ...(s
          ? { shipping: { tier: s.tier, service: s.service, serviceId: s.serviceId, price: s.price, deliveryDays: s.deliveryDays } }
          : {}),
        items: bySeller.get(sellerId)!.items,
      }
    }),
  }
}
