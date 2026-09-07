import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { verifyReviewToken } from "../../../../../utils/review-jwt"
import { extractOrderVariantIds, resolveOrderVariantProducts } from "../../../../../utils/order-review-helpers"
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

  const variantIds = extractOrderVariantIds(order as any)
  const products = await resolveOrderVariantProducts(req.scope, variantIds)

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const existingReviews = await reviewService.listReviews({ orderId: payload.orderId })
  const reviewedProductIds = new Set(existingReviews.map((r: any) => r.productId))

  const items = products.map((product) => ({
    productId: product.productId,
    title: product.title,
    thumbnail: product.thumbnail,
    alreadyReviewed: reviewedProductIds.has(product.productId),
  }))

  res.json({ items })
}
