import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { indexProduct, removeProduct } from "../utils/meilisearch"

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

export async function productCreated({ event, container }: SubscriberArgs<{ id: string }>) {
  const doc = await buildProductDocument(container, event.data.id)
  if (doc) await indexProduct(doc)
}

export async function productUpdated({ event, container }: SubscriberArgs<{ id: string }>) {
  const doc = await buildProductDocument(container, event.data.id)
  if (doc) await indexProduct(doc)
}

export async function productDeleted({ event }: SubscriberArgs<{ id: string }>) {
  await removeProduct(event.data.id)
}

export default productCreated

export const config: SubscriberConfig = {
  event: "product.created",
}
