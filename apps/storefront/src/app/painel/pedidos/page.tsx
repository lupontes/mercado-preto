'use client'

import { useEffect, useState } from 'react'
import { useSellerStore } from '@/lib/seller-store'
import { getSellerOrders } from '@/lib/seller-api'
import { formatPrice } from '@/lib/api'
import { Loader2, ShoppingBag } from 'lucide-react'

type Order = {
  id: string
  display_id?: number
  status: string
  total?: number
  created_at: string
  items?: Array<{ title: string; quantity: number; unit_price: number }>
}

export default function PedidosPage() {
  const { token } = useSellerStore()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    getSellerOrders(token)
      .then((data) => setOrders(data.orders as Order[]))
      .finally(() => setLoading(false))
  }, [token])

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
        <p className="text-onyx/50 text-sm mt-1">{orders.length} pedido(s) encontrado(s)</p>
      </div>

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
                    <OrderStatusBadge status={order.status} />
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
    </div>
  )
}

function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pendente', className: 'bg-amber/10 text-amber-dark' },
    completed: { label: 'Concluído', className: 'bg-forest/10 text-forest' },
    cancelled: { label: 'Cancelado', className: 'bg-terracotta/10 text-terracotta' },
    requires_action: { label: 'Ação necessária', className: 'bg-amber/10 text-amber-dark' },
  }
  const { label, className } = map[status] ?? { label: status, className: 'bg-sand-dark text-onyx/60' }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  )
}
