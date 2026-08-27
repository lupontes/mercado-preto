export type PreferenceItem = {
  title: string
  quantity: number
  price: number
  variantId?: string
  productId: string
}

export type SellerGroup = {
  sellerId: string
  subtotal: number
  shippingShare: number
  items: Array<{ variant_id?: string; title: string; quantity: number; price: number }>
}

export function groupItemsBySeller(
  items: PreferenceItem[],
  sellerByProductId: Record<string, string>,
  shippingPrice: number
): { groups: SellerGroup[] } | { unresolvedProductId: string } {
  for (const item of items) {
    if (!sellerByProductId[item.productId]) {
      return { unresolvedProductId: item.productId }
    }
  }

  const order: string[] = []
  const bySeller = new Map<string, { subtotal: number; items: SellerGroup["items"] }>()

  for (const item of items) {
    const sellerId = sellerByProductId[item.productId]
    if (!bySeller.has(sellerId)) {
      bySeller.set(sellerId, { subtotal: 0, items: [] })
      order.push(sellerId)
    }
    const group = bySeller.get(sellerId)!
    group.subtotal += item.price * item.quantity
    group.items.push({
      variant_id: item.variantId,
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    })
  }

  if (order.length === 0) return { groups: [] }

  const cartSubtotal = order.reduce((sum, id) => sum + bySeller.get(id)!.subtotal, 0)

  const shares = order.map((id) => {
    const subtotal = bySeller.get(id)!.subtotal
    return cartSubtotal > 0 ? Math.floor((shippingPrice * subtotal) / cartSubtotal) : 0
  })

  const allocated = shares.reduce((sum, s) => sum + s, 0)
  const remainder = shippingPrice - allocated

  if (remainder !== 0) {
    let largestIndex = 0
    let largestSubtotal = -1
    order.forEach((id, i) => {
      const subtotal = bySeller.get(id)!.subtotal
      if (subtotal > largestSubtotal) {
        largestSubtotal = subtotal
        largestIndex = i
      }
    })
    shares[largestIndex] += remainder
  }

  return {
    groups: order.map((id, i) => ({
      sellerId: id,
      subtotal: bySeller.get(id)!.subtotal,
      shippingShare: shares[i],
      items: bySeller.get(id)!.items,
    })),
  }
}
