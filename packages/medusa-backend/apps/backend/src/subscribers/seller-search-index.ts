import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"
import { indexSeller, removeSeller } from "../utils/meilisearch"

async function buildSellerDocument(container: any, sellerId: string) {
  const sellerService: SellerModuleService = container.resolve(SELLER_MODULE)
  const [seller] = await sellerService.listSellers({ id: sellerId })
  if (!seller) return null

  return {
    id: seller.id,
    name: seller.name,
    bio: (seller as any).bio,
    category: (seller as any).category,
    location: (seller as any).location,
    status: seller.status,
    created_at: (seller as any).created_at,
  }
}

// Only active stores are searchable. Any other status (or a deleted seller)
// is removed, so a suspension takes the store out of search right away.
export default async function sellerSearchIndex({ event, container }: SubscriberArgs<{ id: string }>) {
  const doc = await buildSellerDocument(container, event.data.id)
  if (doc?.status === "active") {
    await indexSeller(doc)
  } else {
    await removeSeller(event.data.id)
  }
}

export const config: SubscriberConfig = {
  event: ["seller.approved", "seller.status_changed", "seller.updated"],
}
