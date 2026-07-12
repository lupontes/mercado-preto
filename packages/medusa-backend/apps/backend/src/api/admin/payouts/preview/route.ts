import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYOUT_MODULE } from "../../../../modules/payout"
import { COMMISSION_MODULE } from "../../../../modules/commission"
import PayoutModuleService from "../../../../modules/payout/service"
import CommissionModuleService from "../../../../modules/commission/service"

const MATURATION_WINDOW_DAYS = 5

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)

  const { seller_id, period_start, period_end } = req.query as Record<string, string>
  if (!seller_id) {
    return res.status(400).json({ error: "seller_id é obrigatório" })
  }

  let periodStart: Date
  let periodEnd: Date

  if (period_start && period_end) {
    periodStart = new Date(period_start)
    periodEnd = new Date(period_end)
  } else {
    periodEnd = new Date(Date.now() - MATURATION_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    const [lastCompleted] = await payoutService.listPayouts(
      { sellerId: seller_id, status: "completed" },
      { order: { periodEnd: "DESC" }, take: 1 }
    )
    if (lastCompleted) {
      periodStart = new Date(lastCompleted.periodEnd)
    } else {
      const [earliestPending] = await commissionService.listCommissions(
        { sellerId: seller_id, status: "pending", payoutId: null },
        { order: { created_at: "ASC" }, take: 1 }
      )
      periodStart = earliestPending ? new Date(earliestPending.created_at) : periodEnd
    }
  }

  const { amount, commissionCount } = await commissionService.sumUnlinkedPendingInPeriod(
    seller_id,
    periodStart,
    periodEnd
  )

  res.json({
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    amount,
    commissionCount,
  })
}
