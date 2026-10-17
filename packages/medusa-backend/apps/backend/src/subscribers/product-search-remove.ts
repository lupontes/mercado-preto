import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { removeProduct } from "../utils/meilisearch"

export default async function productSearchRemove({ event }: SubscriberArgs<{ id: string }>) {
  await removeProduct(event.data.id)
}

export const config: SubscriberConfig = {
  event: "product.deleted",
}
