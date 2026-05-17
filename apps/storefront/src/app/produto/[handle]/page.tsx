import { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProduct, formatPrice } from '@/lib/api'
import { ArrowLeft, ShoppingBag } from 'lucide-react'

export const revalidate = 60

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  try {
    const { handle } = await params
    const { products } = await getProduct(handle)
    const product = products[0]
    if (!product) return { title: 'Produto' }
    return {
      title: product.title,
      description: product.description ?? `${product.title} disponível no Mercado Preto.`,
      openGraph: {
        images: product.thumbnail ? [product.thumbnail] : [],
      },
    }
  } catch {
    return { title: 'Produto' }
  }
}

export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params

  let product
  try {
    const { products } = await getProduct(handle)
    product = products[0]
  } catch {}

  if (!product) notFound()

  const price = product.variants?.[0]?.prices?.find((p) => p.currency_code === 'brl')

  return (
    <div className="bg-cream min-h-screen">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/produtos"
          className="inline-flex items-center gap-2 text-sm text-onyx/60 hover:text-amber transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar aos produtos
        </Link>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          {/* Imagem */}
          <div className="aspect-square relative rounded-2xl overflow-hidden bg-sand">
            {product.thumbnail ? (
              <Image
                src={product.thumbnail}
                alt={product.title}
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-8xl text-onyx/10">
                🛍️
              </div>
            )}
          </div>

          {/* Detalhes */}
          <div className="flex flex-col justify-center">
            <h1 className="font-display text-3xl sm:text-4xl font-black text-onyx leading-tight">
              {product.title}
            </h1>

            {price && (
              <p className="font-display text-3xl font-bold text-terracotta mt-6">
                {formatPrice(price.amount)}
              </p>
            )}

            {product.description && (
              <p className="text-onyx/70 mt-6 leading-relaxed">{product.description}</p>
            )}

            {product.variants && product.variants.length > 1 && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-onyx mb-3">Variações</p>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => (
                    <button
                      key={v.id}
                      className="rounded-lg border border-sand-dark px-4 py-2 text-sm hover:border-amber transition-colors"
                    >
                      {v.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button className="mt-8 flex items-center justify-center gap-3 rounded-xl bg-amber px-8 py-4 font-display font-bold text-onyx text-lg hover:bg-amber-dark transition-colors">
              <ShoppingBag className="h-5 w-5" />
              Adicionar ao carrinho
            </button>

            <p className="text-xs text-onyx/40 mt-4 text-center">
              Venda realizada por um afroemprendedor do Mercado Preto
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
