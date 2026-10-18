import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { indexProduct } from "../utils/meilisearch"

async function buildProductDocument(container: any, productId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: results } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "handle", "description", "status", "thumbnail", "created_at",
      "seller.id", "seller.name", "seller.category", "seller.location",
    ],
    filters: { id: productId },
  })
  const product = results?.[0]
  if (!product) return null

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description,
    status: product.status,
    thumbnail: product.thumbnail,
    created_at: product.created_at,
    sellerId: (product as any).seller?.id,
    sellerName: (product as any).seller?.name,
    category: (product as any).seller?.category,
    sellerLocation: (product as any).seller?.location,
  }
}

// Medusa runs only the default export of a subscriber file, for every event in
// its config; removal lives in product-search-remove.ts for that reason.
// A draft stays indexed with its status, and the search filter leaves it out.
export default async function productSearchIndex({ event, container }: SubscriberArgs<{ id: string }>) {
  const doc = await buildProductDocument(container, event.data.id)
  if (doc) await indexProduct(doc)
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
