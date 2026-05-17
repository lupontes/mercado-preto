import Link from 'next/link'
import Image from 'next/image'
import { listProducts, formatPrice, type Product } from '@/lib/api'

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

function ProductCard({ product }: { product: Product }) {
  const price = product.variants?.[0]?.prices?.find((p) => p.currency_code === 'brl')

  return (
    <Link
      href={`/produto/${product.handle}`}
      className="group rounded-xl border border-sand-dark overflow-hidden hover:shadow-md hover:border-amber transition-all"
    >
      <div className="aspect-square relative bg-sand">
        {product.thumbnail ? (
          <Image
            src={product.thumbnail}
            alt={product.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-onyx/20">
            🛍️
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-onyx leading-tight group-hover:text-amber transition-colors line-clamp-2">
          {product.title}
        </h3>
        {price ? (
          <p className="font-display font-bold text-terracotta mt-2">
            {formatPrice(price.amount)}
          </p>
        ) : (
          <p className="text-sm text-onyx/40 mt-2">Ver preço</p>
        )}
      </div>
    </Link>
  )
}
