import Link from 'next/link'
import { listProducts, type Product } from '@/lib/api'
import { ProductCard } from './ProductCard'

async function getProducts(): Promise<Product[]> {
  try {
    const { products } = await listProducts({ limit: 6 })
    return products
  } catch {
    return []
  }
}

export async function FeaturedProducts() {
  const products = await getProducts()

  if (products.length === 0) return null

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
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  )
}
