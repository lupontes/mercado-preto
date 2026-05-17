'use client'

import { useEffect, useState } from 'react'
import { useSellerStore } from '@/lib/seller-store'
import { getSellerCommissions } from '@/lib/seller-api'
import { formatPrice } from '@/lib/api'
import { Loader2, DollarSign } from 'lucide-react'

type Commission = {
  id: string
  orderId: string
  grossAmount: number
  bankingFees: number
  netAmount: number
  commissionRate: number
  commissionAmount: number
  sellerPayout: number
  status: string
  created_at: string
}

type Totals = { grossAmount: number; commissionAmount: number; sellerPayout: number }

export default function ComissoesPage() {
  const { token } = useSellerStore()
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [totals, setTotals] = useState<Totals>({ grossAmount: 0, commissionAmount: 0, sellerPayout: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    getSellerCommissions(token)
      .then((data) => {
        setCommissions(data.commissions as Commission[])
        setTotals(data.totals)
      })
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
        <h1 className="font-display text-2xl font-black text-onyx">Comissões e repasses</h1>
        <p className="text-onyx/50 text-sm mt-1">Histórico de ganhos da sua loja</p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total de vendas (bruto)" value={formatPrice(totals.grossAmount)} />
        <SummaryCard label="Comissão Mercado Preto" value={formatPrice(totals.commissionAmount)} muted />
        <SummaryCard label="Seus repasses (líquido)" value={formatPrice(totals.sellerPayout)} highlight />
      </div>

      {commissions.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-dark p-12 text-center">
          <DollarSign className="h-12 w-12 text-onyx/20 mx-auto mb-4" />
          <p className="font-display font-bold text-onyx">Nenhuma comissão ainda</p>
          <p className="text-onyx/50 text-sm mt-1">
            As comissões serão registradas conforme os pagamentos dos pedidos forem confirmados.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sand border-b border-sand-dark">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60">Pedido</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Bruto</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Comissão</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60">Repasse</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-dark">
              {commissions.map((c) => (
                <tr key={c.id} className="hover:bg-sand/40 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-onyx/60">{c.orderId.slice(-8).toUpperCase()}</p>
                    <p className="text-xs text-onyx/40 mt-0.5">{new Date(c.created_at).toLocaleDateString('pt-BR')}</p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-onyx/70">{formatPrice(c.grossAmount)}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-terracotta">
                    -{formatPrice(c.commissionAmount)}
                    <span className="text-xs text-onyx/40 ml-1">({c.commissionRate}%)</span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-forest">{formatPrice(c.sellerPayout)}</td>
                  <td className="px-4 py-3">
                    <PayoutBadge status={c.status} />
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

function SummaryCard({ label, value, muted, highlight }: { label: string; value: string; muted?: boolean; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'border-forest/30 bg-forest/5' : 'border-sand-dark bg-white'}`}>
      <p className="text-xs text-onyx/50 mb-1">{label}</p>
      <p className={`font-display font-black text-xl ${muted ? 'text-terracotta' : highlight ? 'text-forest' : 'text-onyx'}`}>
        {value}
      </p>
    </div>
  )
}

function PayoutBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pendente', className: 'bg-amber/10 text-amber-dark' },
    paid: { label: 'Pago', className: 'bg-forest/10 text-forest' },
  }
  const { label, className } = map[status] ?? { label: status, className: 'bg-sand-dark text-onyx/60' }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  )
}
