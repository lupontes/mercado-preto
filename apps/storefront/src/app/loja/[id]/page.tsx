import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSeller, getSellerProducts, type Product } from '@/lib/api'
import { MapPin, Tag, ArrowLeft } from 'lucide-react'
import { ProductCard } from '@/components/product/ProductCard'

export const revalidate = 60

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  try {
    const { id } = await params
    const { seller } = await getSeller(id)
    return {
      title: seller.name,
      description: seller.bio ?? `Produtos e artesanato de ${seller.name} no Mercado Preto.`,
    }
  } catch {
    return { title: 'Loja' }
  }
}

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let seller
  let products: Product[] = []

  try {
    const data = await getSeller(id)
    seller = data.seller
  } catch {
    notFound()
  }

  try {
    const data = await getSellerProducts(id, { limit: 24 })
    products = data.products
  } catch {}

  const initials = seller.name
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()

  return (
    <div className="bg-cream min-h-screen">
      {/* Header da loja */}
      <div className="bg-onyx text-cream">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <Link
            href="/lojas"
            className="inline-flex items-center gap-2 text-sm text-cream/60 hover:text-amber transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Todas as lojas
          </Link>

          <div className="flex items-start gap-6">
            <div className="w-20 h-20 rounded-full bg-amber/20 flex items-center justify-center font-display font-black text-2xl text-amber shrink-0">
              {initials}
            </div>
            <div>
              <h1 className="font-display text-3xl font-black text-cream">{seller.name}</h1>
              <div className="flex flex-wrap gap-4 mt-2">
                {seller.category && (
                  <span className="flex items-center gap-1 text-sm text-cream/60">
                    <Tag className="h-4 w-4" />
                    {seller.category}
                  </span>
                )}
                {seller.location && (
                  <span className="flex items-center gap-1 text-sm text-cream/60">
                    <MapPin className="h-4 w-4" />
                    {seller.location}
                  </span>
                )}
              </div>
              {seller.bio && (
                <p className="mt-4 text-cream/70 max-w-2xl">{seller.bio}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Produtos */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="font-display text-2xl font-black text-onyx mb-8">
          Produtos ({products.length})
        </h2>

        {products.length === 0 ? (
          <div className="text-center py-16 text-onyx/40">
            <p className="text-xl">Esta loja ainda não tem produtos publicados.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
