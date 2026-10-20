'use client'

import { useEffect, useState } from 'react'
import { getSellerOrders } from '@/lib/seller-api'
import { formatPrice } from '@/lib/api'
import { medusaBaseUrl } from '@/lib/medusa-url'
import { orderStatusBadge } from '@/lib/order-status'
import { Loader2, ShoppingBag } from 'lucide-react'

type Order = {
  id: string
  display_id?: number
  status: string
  shipping_status?: string | null
  shipping_label?: { status: string; tracking_code: string | null; post_by: string | null } | null
  total?: number
  created_at: string
  items?: Array<{ title: string; quantity: number; unit_price: number }>
}

export default function PedidosPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getSellerOrders()
      .then((data) => setOrders(data.orders as Order[]))
      // Without this the page would show an empty history as if there were no sales.
      .catch(() => setError('Não foi possível carregar os pedidos. Tente novamente.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black text-onyx">Pedidos</h1>
        {!error && <p className="text-onyx/50 text-sm mt-1">{orders.length} pedido(s) encontrado(s)</p>}
      </div>

      {/* On a failure, zeroed numbers or an empty list would read as "no sales". */}
      {error ? (
        <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">{error}</p>
      ) : (
      <>

      {orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-dark p-12 text-center">
          <ShoppingBag className="h-12 w-12 text-onyx/20 mx-auto mb-4" />
          <p className="font-display font-bold text-onyx">Nenhum pedido ainda</p>
          <p className="text-onyx/50 text-sm mt-1">
            Os pedidos dos seus clientes aparecerão aqui quando forem realizados.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sand border-b border-sand-dark">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60">Pedido</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Itens</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Total</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden md:table-cell">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-dark">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-sand/40 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-onyx/60">
                      #{order.display_id ?? order.id.slice(-6).toUpperCase()}
                    </p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-onyx/70">
                    {order.items?.length ?? 0} item(s)
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell font-semibold text-onyx">
                    {order.total ? formatPrice(order.total) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} shippingStatus={order.shipping_status} />
                    <LabelInfo orderId={order.id} label={order.shipping_label} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-onyx/50">
                    {new Date(order.created_at).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  )
}

function OrderStatusBadge({ status, shippingStatus }: { status: string; shippingStatus?: string | null }) {
  const { label, className } = orderStatusBadge(status, shippingStatus)
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  )
}

function formatDayMonth(iso: string): string {
  // Sao Paulo, where sellers and buyers read the deadline day.
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function LabelInfo({ orderId, label }: { orderId: string; label?: Order['shipping_label'] }) {
  if (!label) return null
  // A failed purchase is an internal matter the team recovers, so the seller just sees it as in progress.
  if (label.status === 'pending' || label.status === 'failed') {
    return <p className="mt-1 text-xs text-onyx/50">Etiqueta em preparação</p>
  }
  if (label.status !== 'generated') return null
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {/* The print route authenticates by session cookie, so it must stay same-origin in the browser. */}
      <a
        href={`${medusaBaseUrl()}/seller/orders/${orderId}/label`}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-amber underline"
      >
        Imprimir etiqueta
      </a>
      {label.tracking_code && <p className="font-mono text-onyx/60">{label.tracking_code}</p>}
      {label.post_by && <p className="text-onyx/50">{`Postar até ${formatDayMonth(label.post_by)}`}</p>}
    </div>
  )
}
