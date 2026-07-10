import { Metadata } from 'next'
import Link from 'next/link'
import { listCategories, listProducts, type Product } from '@/lib/api'
import { formatCategoryName } from '@/lib/format'
import { ProductCard } from '@/components/product/ProductCard'

export const metadata: Metadata = {
  title: 'Produtos',
  description: 'Explore produtos únicos de afroemprendedores — artesanato, moda, gastronomia e muito mais.',
}

export const revalidate = 60

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; categoria?: string }>
}) {
  const params = await searchParams
  const page = Number(params.page ?? 1)
  const limit = 24
  const offset = (page - 1) * limit

  let products: Product[] = []
  let count = 0
  let activeCategory: { id: string; name: string } | undefined
  let categoryNotFound = false

  try {
    if (params.categoria) {
      const { product_categories } = await listCategories()
      const match = product_categories.find((c) => c.handle === params.categoria)
      if (match) {
        activeCategory = { id: match.id, name: formatCategoryName(match.name) }
      } else {
        categoryNotFound = true
      }
    }

    if (!categoryNotFound) {
      const data = await listProducts({
        q: params.q,
        category_id: activeCategory ? [activeCategory.id] : undefined,
        limit,
        offset,
      })
      products = data.products
      count = data.count
    }
  } catch {}

  const totalPages = Math.ceil(count / limit)
  const pageQuery = (p: number) =>
    `/produtos?page=${p}${params.q ? `&q=${encodeURIComponent(params.q)}` : ''}${
      params.categoria ? `&categoria=${encodeURIComponent(params.categoria)}` : ''
    }`

  return (
    <div className="bg-cream min-h-screen">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <p className="text-forest font-semibold text-sm uppercase tracking-widest mb-2">
            Catálogo
          </p>
          <h1 className="font-display text-4xl font-black text-onyx">
            {categoryNotFound
              ? 'Categoria não encontrada'
              : activeCategory
                ? activeCategory.name
                : 'Todos os produtos'}
          </h1>
          {count > 0 && (
            <p className="text-onyx/60 mt-2">{count} produtos encontrados</p>
          )}
          {(activeCategory || categoryNotFound) && (
            <Link
              href="/categorias"
              className="inline-block text-sm text-onyx/60 hover:text-amber transition-colors mt-2 underline underline-offset-4"
            >
              Ver todas as categorias
            </Link>
          )}
        </div>

        {categoryNotFound ? (
          <div className="text-center py-24 text-onyx/40">
            <p className="text-2xl mb-2">Essa categoria não existe mais</p>
            <p className="text-sm">O link pode estar desatualizado — veja todas as categorias disponíveis.</p>
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-24 text-onyx/40">
            <p className="text-2xl mb-2">Nenhum produto encontrado</p>
            <p className="text-sm">Tente um termo diferente ou volte em breve.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-12">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={pageQuery(p)}
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