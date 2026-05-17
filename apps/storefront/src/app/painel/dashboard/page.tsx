'use client'

import { useEffect, useState } from 'react'
import { useSellerStore } from '@/lib/seller-store'
import { getDashboard } from '@/lib/seller-api'
import { formatPrice } from '@/lib/api'
import { Package, ShoppingBag, DollarSign, TrendingUp, Loader2 } from 'lucide-react'
import Link from 'next/link'

type Stats = {
  totalOrders: number
  pendingOrders: number
  productCount: number
  totalRevenue: number
  pendingPayout: number
}

export default function DashboardPage() {
  const { token, seller } = useSellerStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    getDashboard(token)
      .then((data) => setStats(data.stats))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black text-onyx">
          Olá, {seller?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-onyx/50 text-sm mt-1">Aqui está o resumo da sua loja</p>
      </div>

      {error ? (
        <p className="text-terracotta text-sm">{error}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total de pedidos"
            value={String(stats?.totalOrders ?? 0)}
            icon={<ShoppingBag className="h-5 w-5" />}
            color="amber"
          />
          <StatCard
            label="Pedidos pendentes"
            value={String(stats?.pendingOrders ?? 0)}
            icon={<TrendingUp className="h-5 w-5" />}
            color="terracotta"
          />
          <StatCard
            label="Produtos ativos"
            value={String(stats?.productCount ?? 0)}
            icon={<Package className="h-5 w-5" />}
            color="forest"
          />
          <StatCard
            label="A receber"
            value={formatPrice(stats?.pendingPayout ?? 0)}
            icon={<DollarSign className="h-5 w-5" />}
            color="amber"
          />
        </div>
      )}

      {/* Ações rápidas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <QuickAction
          title="Adicionar produto"
          description="Publique um novo produto na sua loja"
          href="/painel/produtos/novo"
          primary
        />
        <QuickAction
          title="Ver pedidos"
          description="Acompanhe os pedidos dos seus clientes"
          href="/painel/pedidos"
        />
        <QuickAction
          title="Meus produtos"
          description="Gerencie o catálogo da sua loja"
          href="/painel/produtos"
        />
        <QuickAction
          title="Comissões e repasses"
          description="Acompanhe seus ganhos e saldos"
          href="/painel/comissoes"
        />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: string
  icon: React.ReactNode
  color: 'amber' | 'terracotta' | 'forest'
}) {
  const colors = {
    amber: 'bg-amber/10 text-amber',
    terracotta: 'bg-terracotta/10 text-terracotta',
    forest: 'bg-forest/10 text-forest',
  }

  return (
    <div className="bg-white rounded-xl border border-sand-dark p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${colors[color]}`}>
        {icon}
      </div>
      <p className="font-display font-black text-xl text-onyx">{value}</p>
      <p className="text-xs text-onyx/50 mt-0.5">{label}</p>
    </div>
  )
}

function QuickAction({
  title,
  description,
  href,
  primary,
}: {
  title: string
  description: string
  href: string
  primary?: boolean
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 hover:shadow-md transition-all group ${
        primary
          ? 'border-amber bg-amber/5 hover:bg-amber/10'
          : 'border-sand-dark bg-white hover:border-amber'
      }`}
    >
      <p className="font-display font-bold text-onyx group-hover:text-amber transition-colors">
        {title}
      </p>
      <p className="text-sm text-onyx/50 mt-1">{description}</p>
    </Link>
  )
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-6 w-6 animate-spin text-amber" />
    </div>
  )
}
