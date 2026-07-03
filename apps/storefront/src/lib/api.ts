const BASE_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://localhost:9000"
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ""
const REGION_ID = process.env.NEXT_PUBLIC_REGION_ID ?? ""

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    next: { revalidate: 60 },
    headers: {
      "Content-Type": "application/json",
      "x-publishable-api-key": PUB_KEY,
      ...(init?.headers as Record<string, string>),
    },
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json()
}

export type Seller = {
  id: string
  name: string
  bio?: string
  location?: string
  category?: string
  status: string
  created_at?: string
}

export type Product = {
  id: string
  title: string
  handle: string
  description?: string
  thumbnail?: string
  status: string
  variants?: Array<{
    id: string
    title: string
    prices?: Array<{ amount: number; currency_code: string }>
  }>
}

export async function listSellers(params?: {
  category?: string
  location?: string
  limit?: number
  offset?: number
}) {
  const qs = new URLSearchParams()
  if (params?.category) qs.set("category", params.category)
  if (params?.location) qs.set("location", params.location)
  qs.set("limit", String(params?.limit ?? 20))
  qs.set("offset", String(params?.offset ?? 0))
  return apiFetch<{ sellers: Seller[]; count: number }>(`/store/sellers?${qs}`)
}

export async function getSeller(id: string) {
  return apiFetch<{ seller: Seller }>(`/store/sellers/${id}`)
}

export async function getSellerProducts(id: string, params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return apiFetch<{ products: Product[] }>(`/store/sellers/${id}/products?${qs}`)
}

export async function listProducts(params?: {
  q?: string
  limit?: number
  offset?: number
  category_id?: string[]
}) {
  const qs = new URLSearchParams()
  if (params?.q) qs.set("q", params.q)
  qs.set("limit", String(params?.limit ?? 24))
  qs.set("offset", String(params?.offset ?? 0))
  if (REGION_ID) qs.set("region_id", REGION_ID)
  if (params?.category_id) params.category_id.forEach((id) => qs.append("category_id[]", id))
  qs.set("fields", "*variants.prices")
  return apiFetch<{ products: Product[]; count: number; limit: number; offset: number }>(
    `/store/products?${qs}`
  )
}

export type Category = {
  id: string
  name: string
  handle: string
}

export async function listCategories() {
  return apiFetch<{ product_categories: Category[]; count: number }>(
    `/store/product-categories?limit=100&fields=id,name,handle`
  )
}

/**
 * Contagem de produtos publicados por categoria. A Store API não expõe o
 * count diretamente, então agregamos a partir de uma única listagem enxuta
 * (id + categories.id) em vez de uma request por categoria.
 */
export async function countProductsByCategory(): Promise<Record<string, number>> {
  const { products } = await apiFetch<{
    products: Array<{ id: string; categories?: Array<{ id: string }> }>
  }>(`/store/products?limit=1000&fields=id,categories.id`)

  const counts: Record<string, number> = {}
  for (const product of products) {
    for (const category of product.categories ?? []) {
      counts[category.id] = (counts[category.id] ?? 0) + 1
    }
  }
  return counts
}

export async function getProduct(handle: string) {
  const regionParam = REGION_ID ? `&region_id=${REGION_ID}` : ""
  return apiFetch<{ products: Product[] }>(`/store/products?handle=${handle}&fields=*variants.prices${regionParam}`)
}

export async function searchContent(params: {
  q: string
  type?: "products" | "sellers"
  limit?: number
  offset?: number
}) {
  const qs = new URLSearchParams({
    q: params.q,
    type: params.type ?? "products",
    limit: String(params.limit ?? 20),
    offset: String(params.offset ?? 0),
  })
  return apiFetch<{ hits: unknown[]; total: number; query: string }>(`/store/search?${qs}`)
}

export function formatPrice(amount: number, currency = "BRL") {
  return (amount / 100).toLocaleString("pt-BR", { style: "currency", currency })
}
