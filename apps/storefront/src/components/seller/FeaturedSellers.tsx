import Link from 'next/link'

const MOCK_SELLERS = [
  { id: '1', name: 'Ateliê Dandara', category: 'Moda Afro', location: 'Salvador, BA', avatar: '👘' },
  { id: '2', name: 'Raízes do Recôncavo', category: 'Artesanato', location: 'Cachoeira, BA', avatar: '🪆' },
  { id: '3', name: 'Saberes de Axé', category: 'Gastronomia', location: 'Rio de Janeiro, RJ', avatar: '🍲' },
  { id: '4', name: 'Origens Vivas', category: 'Beleza Natural', location: 'São Paulo, SP', avatar: '🌺' },
]

export function FeaturedSellers() {
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
          {MOCK_SELLERS.map((seller) => (
            <Link
              key={seller.id}
              href={`/loja/${seller.id}`}
              className="group rounded-2xl border border-sand-dark bg-white p-6 text-center hover:border-amber hover:shadow-lg transition-all"
            >
              <div className="text-5xl mb-3">{seller.avatar}</div>
              <h3 className="font-display font-bold text-onyx group-hover:text-amber transition-colors">
                {seller.name}
              </h3>
              <p className="text-sm text-onyx/60 mt-1">{seller.category}</p>
              <p className="text-xs text-onyx/40 mt-1">{seller.location}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
