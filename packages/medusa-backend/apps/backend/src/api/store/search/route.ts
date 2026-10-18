import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMeiliClient, meiliFilterValue, PRODUCTS_INDEX, SELLERS_INDEX } from "../../../utils/meilisearch"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../modules/seller"
import SellerModuleService from "../../../modules/seller/service"
import { toPublicSeller } from "../../../utils/public-seller"

type SearchParams = {
  q: string
  type: string
  category?: string
  location?: string
  seller_id?: string
  limit: string
  offset: string
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // A repeated parameter (?category=a&category=b) arrives as an array; only
  // plain strings are used, so odd URLs are ignored rather than crashing.
  const raw = req.query as Record<string, unknown>
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : undefined)
  const q = str("q") ?? ""
  const type = str("type") ?? "products"
  const category = str("category")
  const location = str("location")
  const seller_id = str("seller_id")
  const limit = str("limit") ?? "20"
  const offset = str("offset") ?? "0"
  const params: SearchParams = { q, type, category, location, seller_id, limit, offset }

  const meili = await getMeiliClient()
  if (!meili) {
    return fallbackSearch(req, res, params)
  }

  const indexName = type === "sellers" ? SELLERS_INDEX : PRODUCTS_INDEX

  // Values come from the query string: they are always escaped, or a crafted
  // value could rewrite the filter and expose drafts or inactive stores.
  const filter: string[] = []
  if (type === "products") {
    filter.push('status = "published"')
    if (seller_id) filter.push(`sellerId = ${meiliFilterValue(seller_id)}`)
    if (category) filter.push(`category = ${meiliFilterValue(category)}`)
    if (location) filter.push(`sellerLocation = ${meiliFilterValue(location)}`)
  } else {
    filter.push('status = "active"')
    if (category) filter.push(`category = ${meiliFilterValue(category)}`)
    if (location) filter.push(`location = ${meiliFilterValue(location)}`)
  }

  let result: { hits: unknown[]; estimatedTotalHits?: number }
  try {
    result = await meili.index(indexName).search(q, {
      limit: Number(limit),
      offset: Number(offset),
      filter: filter.join(" AND "),
    })
  } catch (err: unknown) {
    // A broken index must not take search down: the database still answers.
    const logger = req.scope.resolve("logger") as { error: (msg: string) => void }
    logger.error(`[store/search] Meilisearch falhou, usando o banco: ${err instanceof Error ? err.message : String(err)}`)
    return fallbackSearch(req, res, params)
  }

  res.json({
    hits: result.hits,
    total: result.estimatedTotalHits ?? result.hits.length,
    limit: Number(limit),
    offset: Number(offset),
    query: q,
  })
}

const contains = (value: string | null | undefined, q: string) => !!value?.toLowerCase().includes(q.toLowerCase())

// Loads every match and filters in memory, so text and filters apply before
// paging. Fine for a catalog of a few hundred items; move it to SQL beyond that.
async function fallbackSearch(req: MedusaRequest, res: MedusaResponse, params: SearchParams) {
  const { q, type, category, location, seller_id } = params
  const limit = Number(params.limit)
  const offset = Number(params.offset)
  const page = <T>(items: T[]) => items.slice(offset, offset + limit)

  if (type === "sellers") {
    const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
    const sellers = await sellerService.listSellers({ status: "active" })
    const filtered = sellers.filter(
      (s: any) =>
        (!q || contains(s.name, q) || contains(s.bio, q)) &&
        (!category || s.category === category) &&
        (!location || s.location === location)
    )
    // Raw rows include passwordHash, cpfCnpj, email, pixKey and bank data;
    // this endpoint is public, so only the public projection may leave.
    return res.json({ hits: page(filtered).map(toPublicSeller), total: filtered.length, limit, offset, query: q })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail", "status", "description", "seller.id"],
    filters: { status: "published" },
  })
  const filtered = products.filter(
    (p: any) =>
      (!q || contains(p.title, q) || contains(p.description, q)) &&
      (!seller_id || p.seller?.id === seller_id)
  )
  const hits = page(filtered).map(({ seller: _seller, ...product }: any) => product)
  res.json({ hits, total: filtered.length, limit, offset, query: q })
}
