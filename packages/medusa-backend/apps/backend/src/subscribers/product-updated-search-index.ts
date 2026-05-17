import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { indexProduct } from "../utils/meilisearch"

export default async function productUpdatedSearchIndex({ event, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: results } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "handle", "description", "status", "thumbnail", "created_at",
      "seller.id", "seller.name", "seller.category", "seller.location",
    ],
    filters: { id: event.data.id },
  })
  const product = results?.[0]
  if (!product) return

  await indexProduct({
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
  })
}

export const config: SubscriberConfig = {
  event: "product.updated",
}
