import Link from 'next/link'
import { MapPin, Tag } from 'lucide-react'
import { listSellers, type Seller } from '@/lib/api'

async function getSellers(): Promise<Seller[]> {
  try {
    const { sellers } = await listSellers({ limit: 4 })
    return sellers
  } catch {
    return []
  }
}

export async function FeaturedSellers() {
  const sellers = await getSellers()

  if (sellers.length === 0) return null

  return (
    <section className="py-16 bg-cream">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-terracotta font-semibold text-sm uppercase tracking-widest mb-2">
              Nossos vendedores
            </p>
            <h2 className="font-display text-3xl font-black text-onyx">Lojas em destaque</h2>
          </div>
          <Link
            href="/lojas"
            className="hidden sm:block text-sm font-semibold text-amber hover:text-amber-dark transition-colors"
          >
            Ver todas →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {sellers.map((seller) => {
            const initials = seller.name
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase()

            return (
              <Link
                key={seller.id}
                href={`/loja/${seller.id}`}
                className="group rounded-2xl border border-sand-dark bg-white p-6 text-center hover:border-amber hover:shadow-lg transition-all"
              >
                <div className="w-14 h-14 mx-auto rounded-full bg-amber/20 flex items-center justify-center font-display font-black text-lg text-amber mb-3">
                  {initials}
                </div>
                <h3 className="font-display font-bold text-onyx group-hover:text-amber transition-colors leading-tight">
                  {seller.name}
                </h3>
                {seller.category && (
                  <p className="flex items-center justify-center gap-1 text-xs text-onyx/50 mt-1">
                    <Tag className="h-3 w-3" />
                    {seller.category}
                  </p>
                )}
                {seller.location && (
                  <p className="flex items-center justify-center gap-1 text-xs text-onyx/40 mt-1">
                    <MapPin className="h-3 w-3" />
                    {seller.location}
                  </p>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
