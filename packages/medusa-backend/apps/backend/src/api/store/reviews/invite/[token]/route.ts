import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { verifyReviewToken } from "../../../../../utils/review-jwt"
import { REVIEW_MODULE } from "../../../../../modules/review"
import ReviewModuleService from "../../../../../modules/review/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { token } = req.params as { token: string }

  let payload
  try {
    payload = verifyReviewToken(token)
  } catch (err) {
    return res.status(400).json({ error: "Link de avaliação inválido ou expirado" })
  }

  const orderService = req.scope.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(payload.orderId, { relations: ["items"] })
  if (!order) {
    return res.status(400).json({ error: "Pedido não encontrado" })
  }

  const variantIds = ((order as any).items ?? [])
    .map((item: any) => item.variant_id)
    .filter(Boolean)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "product.id", "product.title", "product.thumbnail"],
    filters: { id: variantIds },
  })

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const existingReviews = await reviewService.listReviews({ orderId: payload.orderId })
  const reviewedProductIds = new Set(existingReviews.map((r: any) => r.productId))

  const seen = new Set<string>()
  const items = (data as any[])
    .filter((variant) => variant.product && !seen.has(variant.product.id) && seen.add(variant.product.id))
    .map((variant) => ({
      productId: variant.product.id,
      title: variant.product.title,
      thumbnail: variant.product.thumbnail,
      alreadyReviewed: reviewedProductIds.has(variant.product.id),
    }))

  res.json({ items })
}
