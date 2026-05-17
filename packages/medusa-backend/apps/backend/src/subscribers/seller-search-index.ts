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

export async function sellerApprovedIndex({ event, container }: SubscriberArgs<{ id: string }>) {
  const doc = await buildSellerDocument(container, event.data.id)
  if (doc) await indexSeller(doc)
}

export async function sellerUpdatedIndex({ event, container }: SubscriberArgs<{ id: string }>) {
  const doc = await buildSellerDocument(container, event.data.id)
  if (doc) {
    if (doc.status === "suspended") {
      await removeSeller(doc.id)
    } else {
      await indexSeller(doc)
    }
  }
}

export default sellerApprovedIndex

export const config: SubscriberConfig = {
  event: "seller.approved",
}
