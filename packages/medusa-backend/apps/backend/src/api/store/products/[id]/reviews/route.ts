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
  const { limit = 20, offset = 0 } = req.query as Record<string, string>
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  // The average must reflect every published review, not just the page
  // being returned — fetch the full (unpaginated) set for that computation.
  const allPublished = await reviewService.listReviews({ productId: id, status: "published" })

  const average =
    allPublished.length === 0
      ? null
      : Math.round((allPublished.reduce((sum: number, r: any) => sum + r.rating, 0) / allPublished.length) * 10) / 10

  const published = await reviewService.listReviews(
    { productId: id, status: "published" },
    { order: { created_at: "DESC" }, take: Number(limit), skip: Number(offset) }
  )

  const reviews = published.map((r: any) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    reviewerName: truncateName(r.reviewerName),
    created_at: r.created_at,
  }))

  res.json({ reviews, average, count: allPublished.length })
}
