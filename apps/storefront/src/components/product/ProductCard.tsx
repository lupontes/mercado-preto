import Link from 'next/link'
import Image from 'next/image'
import { formatPrice, type Product } from '@/lib/api'

const DEFAULT_SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw'

type ProductCardProps = {
  product: Product
  sizes?: string
}

export function ProductCard({ product, sizes = DEFAULT_SIZES }: ProductCardProps) {
  const price = product.variants?.[0]?.prices?.find((p) => p.currency_code === 'brl')

  return (
    <Link
      href={`/produto/${product.handle}`}
      className="group rounded-xl border border-sand-dark overflow-hidden hover:shadow-md hover:border-amber transition-all bg-white"
    >
      <div className="aspect-square relative bg-sand">
        {product.thumbnail ? (
          <Image
            src={product.thumbnail}
            alt={product.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes={sizes}
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
          <p className="text-sm text-onyx/40 mt-2">Consulte o preço</p>
        )}
      </div>
    </Link>
  )
}
