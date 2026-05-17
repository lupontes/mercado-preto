import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { COMMISSION_MODULE } from "../../../modules/commission"
import CommissionModuleService from "../../../modules/commission/service"

const UpdateSettingsSchema = z.object({
  commissionRate: z.number().min(0).max(100).optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const rate = await commissionService.getCommissionRate()
  res.json({ settings: { commissionRate: rate } })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const parsed = UpdateSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)

  if (parsed.data.commissionRate !== undefined) {
    await commissionService.setCommissionRate(parsed.data.commissionRate)
  }

  const rate = await commissionService.getCommissionRate()
  res.json({ settings: { commissionRate: rate }, message: "Configurações atualizadas" })
}
