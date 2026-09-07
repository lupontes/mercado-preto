import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { verifyReviewToken } from "../../../utils/review-jwt"
import { REVIEW_MODULE } from "../../../modules/review"
import ReviewModuleService from "../../../modules/review/service"

const BodySchema = z.object({
  token: z.string(),
  productId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const { token, productId, rating, comment } = parsed.data

  let payload
  try {
    payload = verifyReviewToken(token)
  } catch (err) {
    return res.status(400).json({ error: "Link de avaliação inválido ou expirado" })
  }

  const orderService = req.scope.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(payload.orderId, {
    relations: ["shipping_address"],
    select: ["metadata", "email"],
  })
  if (!order) {
    return res.status(400).json({ error: "Pedido não encontrado" })
  }

  // sellerId is always derived server-side from the order — never trust a
  // client-supplied sellerId in the request body, which would let a buyer
  // attribute a review to any seller they choose.
  const sellerId = (order.metadata as any)?.seller_id
  const reviewerName = (order as any).shipping_address?.first_name ?? "Cliente"

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  try {
    const review = await reviewService.createReviews({
      orderId: payload.orderId,
      productId,
      sellerId,
      rating,
      comment,
      reviewerName,
    })
    res.json({ review: { id: review.id, status: review.status } })
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Você já avaliou este produto" })
    }
    throw err
  }
}
