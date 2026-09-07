import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { REVIEW_MODULE } from "../../../../modules/review"
import ReviewModuleService from "../../../../modules/review/service"

const BodySchema = z.object({
  status: z.enum(["published", "rejected"]),
})

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params as { id: string }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Status inválido" })
  }

  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const existing: any = await reviewService.retrieveReview(id)
  if (!existing || existing.sellerId !== sellerId) {
    return res.status(404).json({ error: "Avaliação não encontrada" })
  }

  const [review] = await reviewService.updateReviews({
    selector: { id },
    data: { status: parsed.data.status },
  })

  res.json({ review: { id: review.id, status: review.status } })
}
