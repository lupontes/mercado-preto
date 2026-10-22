import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { notifySellerProductApproved } from "../utils/product-moderation-notify"

// Records the first publication of a product. The update below fires
// product.updated again; by then approved_at exists, which is what stops the loop.
export default async function productApproved({ event, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "handle", "status", "metadata",
      "seller.name", "seller.phone", "seller.email",
    ],
    filters: { id: event.data.id },
  })
  const product: any = data?.[0]
  if (!product || product.status !== "published") return

  const metadata: Record<string, unknown> = product.metadata ?? {}
  if (metadata.approved_at) return

  const wasSubmitted = Boolean(metadata.submitted_at)

  // Medusa merges metadata and keeps stored keys that are absent from the update;
  // only an empty string deletes one, so submitted_at must be sent as "".
  await container.resolve(Modules.PRODUCT).updateProducts(product.id, {
    metadata: { ...metadata, approved_at: new Date().toISOString(), submitted_at: "" },
  })

  // Admin/importer publications were never in review: nothing to tell the seller.
  if (!wasSubmitted || !product.seller) return

  try {
    await notifySellerProductApproved(
      product.seller,
      { id: product.id, title: product.title, handle: product.handle },
      "new"
    )
  } catch (error) {
    // The approval is already recorded; a failed notice must not fail the subscriber.
    console.error(`[product-approved] failed to notify seller for ${product.id}`, error)
  }
}

export const config: SubscriberConfig = {
  event: "product.updated",
}
