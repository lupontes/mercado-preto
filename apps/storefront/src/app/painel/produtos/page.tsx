'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { getSellerProducts, deleteSellerProduct } from '@/lib/seller-api'
import { formatPrice } from '@/lib/api'
import { Plus, Pencil, Trash2, Loader2, Package } from 'lucide-react'

type Product = {
  id: string
  title: string
  status: string
  thumbnail?: string
  categories?: Array<{ id: string; name: string }>
  variants?: Array<{
    prices?: Array<{ amount: number; currency_code: string }>
  }>
}

export default function ProdutosPage() {
  const { token } = useSellerStore()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    if (!token) return
    try {
      const data = await getSellerProducts(token)
      setProducts(data.products as Product[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token])

  async function handleDelete(id: string) {
    if (!token || !confirm('Tem certeza que deseja excluir este produto?')) return
    setDeletingId(id)
    try {
      await deleteSellerProduct(token, id)
      setProducts((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao excluir produto')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-onyx">Meus produtos</h1>
          <p className="text-onyx/50 text-sm mt-1">{products.length} produto(s)</p>
        </div>
        <Link
          href="/painel/produtos/novo"
          className="flex items-center gap-2 rounded-xl bg-amber px-4 py-2.5 font-semibold text-sm text-onyx hover:bg-amber-dark transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo produto
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-dark p-12 text-center">
          <Package className="h-12 w-12 text-onyx/20 mx-auto mb-4" />
          <p className="font-display font-bold text-onyx">Nenhum produto ainda</p>
          <p className="text-onyx/50 text-sm mt-1">
            Adicione seus primeiros produtos para que clientes possam encontrá-los.
          </p>
          <Link
            href="/painel/produtos/novo"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber px-4 py-2 font-semibold text-sm text-onyx hover:bg-amber-dark transition-colors"
          >
            <Plus className="h-4 w-4" />
            Adicionar produto
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sand border-b border-sand-dark">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60">Produto</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Categoria</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Preço</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-onyx/60">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-dark">
              {products.map((product) => {
                const price = product.variants?.[0]?.prices?.find((p) => p.currency_code === 'brl')
                return (
                  <tr key={product.id} className="hover:bg-sand/40 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-onyx line-clamp-1">{product.title}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-onyx/70">
                      {product.categories?.[0]?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-onyx/70">
                      {price ? formatPrice(price.amount) : '—'}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/painel/produtos/${product.id}`}
                          className="p-2 rounded-lg text-onyx/40 hover:text-amber hover:bg-amber/10 transition-colors"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => handleDelete(product.id)}
                          disabled={deletingId === product.id}
                          className="p-2 rounded-lg text-onyx/40 hover:text-terracotta hover:bg-terracotta/10 transition-colors disabled:opacity-30"
                          title="Excluir"
                        >
                          {deletingId === product.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    published: { label: 'Publicado', className: 'bg-forest/10 text-forest' },
    draft: { label: 'Rascunho', className: 'bg-sand-dark text-onyx/60' },
    proposed: { label: 'Proposto', className: 'bg-amber/10 text-amber-dark' },
    rejected: { label: 'Rejeitado', className: 'bg-terracotta/10 text-terracotta' },
  }
  const { label, className } = map[status] ?? { label: status, className: 'bg-sand-dark text-onyx/60' }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  )
}
