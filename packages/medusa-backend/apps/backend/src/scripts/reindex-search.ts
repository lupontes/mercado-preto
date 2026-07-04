import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"
import {
  ensureIndexes,
  getMeiliClient,
  indexProduct,
  indexSeller,
} from "../utils/meilisearch"

/**
 * Full search index (MeiliSearch) backfill from the database. Same behavior
 * as POST /admin/search/reindex, but runnable via CLI:
 *   npx medusa exec ./src/scripts/reindex-search.ts
 */
export default async function reindexSearch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const meili = await getMeiliClient()
  if (!meili) {
    logger.error("MeiliSearch not configured. Set MEILISEARCH_HOST.")
    return
  }

  await ensureIndexes()

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const sellerService: SellerModuleService = container.resolve(SELLER_MODULE)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "handle", "description", "status", "thumbnail", "created_at",
      "seller.id", "seller.name", "seller.category", "seller.location",
    ],
    filters: { status: "published" },
  })

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

  const sellers = await sellerService.listSellers({ status: "active" })
  let sellerCount = 0
  for (const s of sellers) {
    await indexSeller({
      id: s.id,
      name: s.name,
      bio: (s as any).bio,
      category: (s as any).category,
      location: (s as any).location,
      status: (s as any).status,
      created_at: (s as any).created_at,
    })
    sellerCount++
  }

  logger.info(`Reindex complete: ${productCount} products, ${sellerCount} sellers.`)
}
