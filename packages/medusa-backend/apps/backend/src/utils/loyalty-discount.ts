/**
 * Splits a points discount across the stores of one checkout, in proportion to
 * each store's items. Leftover cents from rounding go to the first store, so
 * the parts always add up to the discount.
 */
export function allocateLoyaltyDiscount(
  groups: Array<{ sellerId: string; itemsTotal: number }>,
  discount: number
): Record<string, number> {
  const itemsTotal = groups.reduce((sum, g) => sum + g.itemsTotal, 0)
  const shares: Record<string, number> = {}
  for (const g of groups) {
    shares[g.sellerId] = itemsTotal > 0 ? Math.floor((discount * g.itemsTotal) / itemsTotal) : 0
  }
  const allocated = Object.values(shares).reduce((sum, v) => sum + v, 0)
  if (groups[0]) shares[groups[0].sellerId] += discount - allocated
  return shares
}

/**
 * The platform pays for points out of its commission, so a discount larger
 * than the commission on these items would make the platform pay to sell.
 */
export function loyaltyDiscountCap(itemsTotal: number, commissionRatePercent: number): number {
  return Math.floor((itemsTotal * commissionRatePercent) / 100)
}
