import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMISSION_MODULE } from "../../../modules/commission"
import CommissionModuleService from "../../../modules/commission/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const filters: Record<string, string> = { sellerId }
  if (status) filters.status = status

  const commissions = await commissionService.listCommissions(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const totals = commissions.reduce(
    (acc, c) => ({
      grossAmount: acc.grossAmount + Number(c.grossAmount),
      commissionAmount: acc.commissionAmount + Number(c.commissionAmount),
      sellerPayout: acc.sellerPayout + Number(c.sellerPayout),
    }),
    { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 }
  )

  res.json({ commissions, totals, count: commissions.length })
}
