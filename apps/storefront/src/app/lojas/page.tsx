import { Metadata } from 'next'
import Link from 'next/link'
import { listSellers, type Seller } from '@/lib/api'
import { MapPin, Tag } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Lojas',
  description: 'Conheça os afroemprendedores do Mercado Preto — artesãos, costureiras, chefs e mais.',
}

export const revalidate = 60

export default async function LojasPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; location?: string; page?: string }>
}) {
  const params = await searchParams
  const page = Number(params.page ?? 1)
  const limit = 24
  const offset = (page - 1) * limit

  let sellers: Seller[] = []
  let count = 0

  try {
    const data = await listSellers({ category: params.category, location: params.location, limit, offset })
    sellers = data.sellers
    count = data.count
  } catch {}

  const totalPages = Math.ceil(count / limit)

  return (
    <div className="bg-cream min-h-screen">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <p className="text-terracotta font-semibold text-sm uppercase tracking-widest mb-2">
            Comunidade de vendedores
          </p>
          <h1 className="font-display text-4xl font-black text-onyx">Nossas lojas</h1>
          <p className="text-onyx/60 mt-2">
            {count > 0 ? `${count} vendedores ativos` : 'Carregando vendedores...'}
          </p>
        </div>

        {sellers.length === 0 ? (
          <div className="text-center py-24 text-onyx/40">
            <p className="text-2xl mb-2">Nenhuma loja encontrada</p>
            <p className="text-sm">Volte em breve — novos vendedores chegando!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sellers.map((seller) => (
              <SellerCard key={seller.id} seller={seller} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-12">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={`/lojas?page=${p}`}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold transition-colors ${
                  p === page
                    ? 'bg-amber text-onyx'
                    : 'bg-white border border-sand-dark text-onyx/60 hover:border-amber'
                }`}
              >
                {p}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SellerCard({ seller }: { seller: Seller }) {
  const initials = seller.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <Link
      href={`/loja/${seller.id}`}
      className="group rounded-2xl border border-sand-dark bg-white p-6 hover:border-amber hover:shadow-lg transition-all"
    >
      <div className="w-16 h-16 rounded-full bg-amber/20 flex items-center justify-center font-display font-black text-xl text-amber mb-4">
        {initials}
      </div>
      <h2 className="font-display font-bold text-onyx group-hover:text-amber transition-colors leading-tight">
        {seller.name}
      </h2>
      {seller.bio && (
        <p className="text-sm text-onyx/60 mt-2 line-clamp-2">{seller.bio}</p>
      )}
      <div className="flex flex-wrap gap-3 mt-4">
        {seller.category && (
          <span className="flex items-center gap-1 text-xs text-onyx/50">
            <Tag className="h-3 w-3" />
            {seller.category}
          </span>
        )}
        {seller.location && (
          <span className="flex items-center gap-1 text-xs text-onyx/50">
            <MapPin className="h-3 w-3" />
            {seller.location}
          </span>
        )}
      </div>
    </Link>
  )
}
