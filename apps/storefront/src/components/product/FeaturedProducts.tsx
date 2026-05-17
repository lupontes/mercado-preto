import Link from 'next/link'

const MOCK_PRODUCTS = [
  { id: '1', name: 'Torso de Candomblé em Cerâmica', seller: 'Raízes do Recôncavo', price: 18000, category: 'Artesanato' },
  { id: '2', name: 'Turbante Afro Estampado', seller: 'Ateliê Dandara', price: 8500, category: 'Moda' },
  { id: '3', name: 'Kit Acarajé Gourmet', seller: 'Saberes de Axé', price: 4500, category: 'Gastronomia' },
  { id: '4', name: 'Óleo de Coco Artesanal 200ml', seller: 'Origens Vivas', price: 3200, category: 'Beleza' },
  { id: '5', name: 'Colagem Orixás em Papel', seller: 'Raízes do Recôncavo', price: 12000, category: 'Arte' },
  { id: '6', name: 'Bijuteria Búzios e Miçangas', seller: 'Ateliê Dandara', price: 5500, category: 'Acessórios' },
]

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function FeaturedProducts() {
  return (
    <section className="py-16 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-forest font-semibold text-sm uppercase tracking-widest mb-2">
              Produtos selecionados
            </p>
            <h2 className="font-display text-3xl font-black text-onyx">Em destaque</h2>
          </div>
          <Link
            href="/produtos"
            className="hidden sm:block text-sm font-semibold text-amber hover:text-amber-dark transition-colors"
          >
            Ver todos →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {MOCK_PRODUCTS.map((product) => (
            <Link
              key={product.id}
              href={`/produto/${product.id}`}
              className="group rounded-xl border border-sand-dark overflow-hidden hover:shadow-md hover:border-amber transition-all"
            >
              <div className="aspect-square bg-sand flex items-center justify-center text-5xl">
                🛍️
              </div>
              <div className="p-3">
                <p className="text-xs text-onyx/50 mb-1">{product.category}</p>
                <h3 className="text-sm font-semibold text-onyx leading-tight group-hover:text-amber transition-colors line-clamp-2">
                  {product.name}
                </h3>
                <p className="text-xs text-onyx/50 mt-1 truncate">{product.seller}</p>
                <p className="font-display font-bold text-terracotta mt-2">
                  {formatPrice(product.price)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
