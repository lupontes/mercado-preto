import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"
import {
  ensureIndexes,
  getMeiliClient,
  indexProduct,
  indexSeller,
  PRODUCTS_INDEX,
  SELLERS_INDEX,
} from "../../../../utils/meilisearch"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const meili = await getMeiliClient()
  if (!meili) {
    return res.status(503).json({ error: "Meilisearch não configurado. Defina MEILISEARCH_HOST." })
  }

  await ensureIndexes()

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "handle", "description", "status", "thumbnail", "created_at",
      "seller.id", "seller.name", "seller.category", "seller.location",
    ],
    filters: { status: "published" },
  })

  const sellers = await sellerService.listSellers({ status: "active" })

  let productCount = 0
  for (const p of products) {
    await indexProduct({
      id: p.id,
      title: p.title,
      handle: p.handle,
      description: p.description,
      status: p.status,
      thumbnail: p.thumbnail,
      created_at: p.created_at,
      sellerId: (p as any).seller?.id,
      sellerName: (p as any).seller?.name,
      category: (p as any).seller?.category,
      sellerLocation: (p as any).seller?.location,
    })
    productCount++
  }

  let sellerCount = 0
  for (const s of sellers) {
    await indexSeller({
      id: s.id,
      name: s.name,
      bio: (s as any).bio,
      category: (s as any).category,
      location: (s as any).location,
      status: s.status,
      created_at: (s as any).created_at,
    })
    sellerCount++
  }

  res.json({
    message: "Reindexação concluída",
    indexed: { products: productCount, sellers: sellerCount },
  })
}
