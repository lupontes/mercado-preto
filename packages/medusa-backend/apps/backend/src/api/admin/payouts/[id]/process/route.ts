import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYOUT_MODULE } from "../../../../../modules/payout"
import PayoutModuleService from "../../../../../modules/payout/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const { id } = req.params

  const [existing] = await payoutService.listPayouts({ id })
  if (!existing) return res.status(404).json({ error: "Repasse não encontrado" })
  if (existing.status === "completed") {
    return res.status(409).json({ error: "Repasse já processado" })
  }

  const payout = await payoutService.markAsProcessed(id)
  res.json({ payout })
}
