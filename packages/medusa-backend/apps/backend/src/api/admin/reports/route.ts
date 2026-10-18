import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMISSION_MODULE } from "../../../modules/commission"
import { PAYOUT_MODULE } from "../../../modules/payout"
import { SELLER_MODULE } from "../../../modules/seller"
import CommissionModuleService from "../../../modules/commission/service"
import PayoutModuleService from "../../../modules/payout/service"
import SellerModuleService from "../../../modules/seller/service"

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A bare date covers the whole day (UTC, like the stored timestamps), so
 * "until 2026-10-31" includes sales made on the 31st. Full ISO values are
 * kept as sent. Returns null for anything that is not a real date.
 */
function parsePeriodBoundary(value: string, endOfDay: boolean): Date | null {
  const iso = DATE_ONLY.test(value) ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  // new Date("2026-02-31") rolls over to March; a rolled-over day is invalid.
  if (DATE_ONLY.test(value) && date.toISOString().slice(0, 10) !== value) return null
  return date
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { period_start, period_end } = req.query as Record<string, string>

  const start = period_start ? parsePeriodBoundary(period_start, false) : new Date(new Date().setDate(1))
  const end = period_end ? parsePeriodBoundary(period_end, true) : new Date()
  if (!start || !end || start > end) {
    return res.status(400).json({ error: "Período inválido" })
  }

  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const [allCommissions, allPayouts, allSellers] = await Promise.all([
    commissionService.listCommissions({}),
    payoutService.listPayouts({}),
    sellerService.listSellers({}),
  ])

  const periodCommissions = allCommissions.filter((c: any) => {
    const d = new Date(c.created_at)
    return d >= start && d <= end
  })

  const periodPayouts = allPayouts.filter((p: any) => {
    const d = new Date(p.created_at)
    return d >= start && d <= end
  })

  const totalGmv = periodCommissions.reduce(
    (acc: number, c: any) => acc + Number(c.grossAmount ?? 0),
    0
  )
  const totalCommission = periodCommissions.reduce(
    (acc: number, c: any) => acc + Number(c.commissionAmount ?? 0),
    0
  )
  const totalPayouts = periodPayouts
    .filter((p: any) => p.status === "completed")
    .reduce((acc: number, p: any) => acc + Number(p.amount ?? 0), 0)
  const pendingPayouts = periodPayouts
    .filter((p: any) => p.status === "pending")
    .reduce((acc: number, p: any) => acc + Number(p.amount ?? 0), 0)

  const sellerBreakdown = allSellers.map((seller: any) => {
    const sellerCommissions = periodCommissions.filter(
      (c: any) => c.sellerId === seller.id
    )
    const sellerPayouts = periodPayouts.filter(
      (p: any) => p.sellerId === seller.id && p.status === "completed"
    )
    return {
      sellerId: seller.id,
      sellerName: seller.name,
      gmv: sellerCommissions.reduce((acc: number, c: any) => acc + Number(c.grossAmount ?? 0), 0),
      commission: sellerCommissions.reduce((acc: number, c: any) => acc + Number(c.commissionAmount ?? 0), 0),
      payouts: sellerPayouts.reduce((acc: number, p: any) => acc + Number(p.amount ?? 0), 0),
      orderCount: sellerCommissions.length,
    }
  }).filter((s: any) => s.orderCount > 0)

  res.json({
    period: { start: start.toISOString(), end: end.toISOString() },
    summary: {
      totalGmv,
      totalCommission,
      totalPayouts,
      pendingPayouts,
      orderCount: periodCommissions.length,
      activeSellers: sellerBreakdown.length,
    },
    sellers: sellerBreakdown,
  })
}
