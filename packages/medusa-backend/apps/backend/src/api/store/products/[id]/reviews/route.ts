import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../../../modules/review"
import ReviewModuleService from "../../../../../modules/review/service"

function truncateName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params as { id: string }
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  const published = await reviewService.listReviews(
    { productId: id, status: "published" },
    { order: { created_at: "DESC" } }
  )

  const reviews = published.map((r: any) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    reviewerName: truncateName(r.reviewerName),
    created_at: r.created_at,
  }))

  const average =
    reviews.length === 0
      ? null
      : Math.round((reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length) * 10) / 10

  res.json({ reviews, average, count: reviews.length })
}
