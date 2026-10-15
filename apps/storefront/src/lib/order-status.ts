export type OrderStatusBadge = { label: string; className: string }

const PENDING = 'bg-amber/10 text-amber-dark'
const DONE = 'bg-forest/10 text-forest'
const CANCELED = 'bg-terracotta/10 text-terracotta'
const NEUTRAL = 'bg-sand-dark text-onyx/60'

const SHIPPING_BADGES: Record<string, OrderStatusBadge> = {
  awaiting_shipment: { label: 'Aguardando envio', className: PENDING },
  shipped: { label: 'Enviado', className: 'bg-amber/20 text-onyx' },
  delivered: { label: 'Entregue', className: DONE },
}

const ORDER_BADGES: Record<string, OrderStatusBadge> = {
  pending: { label: 'Pendente', className: PENDING },
  completed: { label: 'Concluído', className: DONE },
  requires_action: { label: 'Ação necessária', className: PENDING },
}

/**
 * Badge for a seller order. Cancellation lives on the Medusa order status and
 * wins over shipping progress; otherwise the shipping status is what matters
 * to the seller. Orders created before shipping_status existed fall back to
 * the order status.
 */
export function orderStatusBadge(status: string, shippingStatus?: string | null): OrderStatusBadge {
  // Medusa spells it "canceled"; "cancelled" is kept for the label this panel already used.
  if (status === 'canceled' || status === 'cancelled') return { label: 'Cancelado', className: CANCELED }
  if (shippingStatus) return SHIPPING_BADGES[shippingStatus] ?? { label: shippingStatus, className: NEUTRAL }
  return ORDER_BADGES[status] ?? { label: status, className: NEUTRAL }
}
