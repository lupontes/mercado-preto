// Kept free of framework imports: the admin widget bundles this file too.

/**
 * Shipping progress of a seller order, stored in `order.metadata.shipping_status`.
 * Medusa's native fulfillment status is not used because our orders are created
 * outside its cart/checkout workflow (see api/seller/orders/route.ts), so its
 * derived statuses are incomplete for them. Cancellation stays on `order.status`.
 */
export type ShippingStatus = "awaiting_shipment" | "shipped" | "delivered"

// Orders are only created after the payment is approved, so they start here.
export const INITIAL_SHIPPING_STATUS: ShippingStatus = "awaiting_shipment"

export const SHIPPING_STATUS_LABELS: Record<ShippingStatus, string> = {
  awaiting_shipment: "Aguardando envio",
  shipped: "Enviado",
  delivered: "Entregue",
}

type OrderServiceLike = {
  listOrders: (filters: any, config?: any) => Promise<any[]>
  updateOrders: (id: string, data: any) => Promise<unknown>
}

/**
 * Gives orders created before shipping_status existed their initial status.
 * Canceled orders and orders that already have a status are left untouched.
 * Returns the ids of the updated orders.
 */
export async function backfillShippingStatus(
  orderService: OrderServiceLike,
  pageSize = 200
): Promise<string[]> {
  const updated: string[] = []
  for (let skip = 0; ; skip += pageSize) {
    const orders = await orderService.listOrders(
      {},
      { select: ["id", "status", "metadata"], take: pageSize, skip, order: { created_at: "ASC" } }
    )
    for (const order of orders) {
      if (order.status === "canceled" || order.metadata?.shipping_status) continue
      // The full metadata object is sent so the update never drops existing keys.
      await orderService.updateOrders(order.id, {
        metadata: { ...(order.metadata ?? {}), shipping_status: INITIAL_SHIPPING_STATUS },
      })
      updated.push(order.id)
    }
    if (orders.length < pageSize) return updated
  }
}
