import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMeiliClient, PRODUCTS_INDEX, SELLERS_INDEX } from "../../../utils/meilisearch"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../modules/seller"
import SellerModuleService from "../../../modules/seller/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const {
    q = "",
    type = "products",
    category,
    location,
    seller_id,
    limit = "20",
    offset = "0",
  } = req.query as Record<string, string>

  const meili = await getMeiliClient()

  if (!meili) {
    return fallbackSearch(req, res, { q, type, category, location, seller_id, limit, offset })
  }

  const indexName = type === "sellers" ? SELLERS_INDEX : PRODUCTS_INDEX

  const filter: string[] = []
  if (type === "products") {
    filter.push('status = "published"')
    if (seller_id) filter.push(`sellerId = "${seller_id}"`)
    if (category) filter.push(`category = "${category}"`)
    if (location) filter.push(`sellerLocation = "${location}"`)
  } else {
    filter.push('status = "active"')
    if (category) filter.push(`category = "${category}"`)
    if (location) filter.push(`location = "${location}"`)
  }

  const result = await meili.index(indexName).search(q, {
    limit: Number(limit),
    offset: Number(offset),
    filter: filter.join(" AND ") || undefined,
  })

  res.json({
    hits: result.hits,
    total: result.estimatedTotalHits ?? result.hits.length,
    limit: Number(limit),
    offset: Number(offset),
    query: q,
  })
}

async function fallbackSearch(
  req: MedusaRequest,
  res: MedusaResponse,
  params: Record<string, string>
) {
  const { q, type, seller_id, limit, offset } = params

  if (type === "sellers") {
    const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
    const sellers = await sellerService.listSellers(
      { status: "active" },
      { take: Number(limit), skip: Number(offset) }
    )
    const filtered = q
      ? sellers.filter((s: any) =>
          s.name?.toLowerCase().includes(q.toLowerCase()) ||
          s.bio?.toLowerCase().includes(q.toLowerCase())
        )
      : sellers

    return res.json({ hits: filtered, total: filtered.length, query: q })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail", "status", "description"],
    filters: { status: "published" },
    pagination: { take: Number(limit), skip: Number(offset) },
  })

  const filtered = q
    ? products.filter((p: any) =>
        p.title?.toLowerCase().includes(q.toLowerCase()) ||
        p.description?.toLowerCase().includes(q.toLowerCase())
      )
    : products

  res.json({ hits: filtered, total: filtered.length, query: q })
}
