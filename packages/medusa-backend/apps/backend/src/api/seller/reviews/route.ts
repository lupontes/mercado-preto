import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../modules/review"
import ReviewModuleService from "../../../modules/review/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { status = "pending", limit = 20, offset = 0 } = req.query as Record<string, string>

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const reviews = await reviewService.listReviews(
    { sellerId, status },
    { take: Number(limit), skip: Number(offset), order: { created_at: "DESC" } }
  )

  res.json({ reviews, count: reviews.length })
}
