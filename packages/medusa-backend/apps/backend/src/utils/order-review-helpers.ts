import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type OrderVariantProduct = {
  productId: string
  title: string
  thumbnail: string | null
}

type OrderWithItems = {
  items?: Array<{ variant_id?: string | null }>
} | null

/**
 * Extracts the (deduplicated) variant ids referenced by an order's line items.
 */
export function extractOrderVariantIds(order: OrderWithItems): string[] {
  const variantIds = (order?.items ?? [])
    .map((item) => item.variant_id)
    .filter((variantId): variantId is string => Boolean(variantId))

  return Array.from(new Set(variantIds))
}

/**
 * Resolves the distinct products behind a set of variant ids via the product
 * graph. Used to figure out which products actually belong to an order, so a
 * buyer can't submit/see a review for a product they never purchased.
 */
export async function resolveOrderVariantProducts(
  scope: MedusaContainer,
  variantIds: string[]
): Promise<OrderVariantProduct[]> {
  if (variantIds.length === 0) {
    return []
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "product.id", "product.title", "product.thumbnail"],
    filters: { id: variantIds },
  })

  const seen = new Set<string>()
  return (data as any[])
    .filter((variant) => variant.product && !seen.has(variant.product.id) && seen.add(variant.product.id))
    .map((variant) => ({
      productId: variant.product.id,
      title: variant.product.title,
      thumbnail: variant.product.thumbnail,
    }))
}

/**
 * Returns the set of product ids that genuinely belong to the given order.
 * Retrieves the order itself (with its line items) so callers only need an
 * orderId — e.g. one already trusted from a signed review token.
 */
export async function resolveOrderProductIds(scope: MedusaContainer, orderId: string): Promise<Set<string>> {
  const orderService = scope.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(orderId, { relations: ["items"] })
  const variantIds = extractOrderVariantIds(order as OrderWithItems)
  const products = await resolveOrderVariantProducts(scope, variantIds)
  return new Set(products.map((product) => product.productId))
}
