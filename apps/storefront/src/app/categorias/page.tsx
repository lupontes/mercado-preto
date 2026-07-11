import { Metadata } from 'next'
import Link from 'next/link'
import { countProductsByCategory, listCategories, type Category } from '@/lib/api'
import { formatCategoryName } from '@/lib/format'

export const metadata: Metadata = {
  title: 'Categorias',
  description:
    'Navegue o catálogo do Mercado Preto por categoria — bolsas, decoração, colares, moda africana e muito mais.',
}

export const revalidate = 60

export default async function CategoriasPage() {
  let categories: Array<Category & { productCount: number }> = []

  try {
    const [{ product_categories }, counts] = await Promise.all([
      listCategories(),
      countProductsByCategory(),
    ])
    categories = product_categories
      .map((category) => ({ ...category, productCount: counts[category.id] ?? 0 }))
      .filter((category) => category.productCount > 0)
      .sort((a, b) => b.productCount - a.productCount)
  } catch {}

  return (
    <div className="bg-cream min-h-screen">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <p className="text-forest font-semibold text-sm uppercase tracking-widest mb-2">
            Catálogo
          </p>
          <h1 className="font-display text-4xl font-black text-onyx">Categorias</h1>
          {categories.length > 0 && (
            <p className="text-onyx/60 mt-2">
              {categories.length} categorias com produtos disponíveis
            </p>
          )}
        </div>

        {categories.length === 0 ? (
          <div className="text-center py-24 text-onyx/40">
            <p className="text-2xl mb-2">Nenhuma categoria disponível</p>
            <p className="text-sm">Volte em breve — o catálogo está em expansão.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/produtos?categoria=${encodeURIComponent(category.handle)}`}
                className="group rounded-xl border border-sand-dark bg-white p-6 hover:border-amber hover:shadow-md transition-all"
              >
                <h2 className="font-display text-lg font-bold text-onyx leading-tight group-hover:text-amber transition-colors">
                  {formatCategoryName(category.name)}
                </h2>
                <p className="text-sm text-onyx/50 mt-2">
                  {category.productCount}{' '}
                  {category.productCount === 1 ? 'produto' : 'produtos'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
