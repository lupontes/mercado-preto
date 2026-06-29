import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMISSION_MODULE } from "../../../modules/commission"
import { PAYOUT_MODULE } from "../../../modules/payout"
import { SELLER_MODULE } from "../../../modules/seller"
import CommissionModuleService from "../../../modules/commission/service"
import PayoutModuleService from "../../../modules/payout/service"
import SellerModuleService from "../../../modules/seller/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { period_start, period_end } = req.query as Record<string, string>

  const start = period_start ? new Date(period_start) : new Date(new Date().setDate(1))
  const end = period_end ? new Date(period_end) : new Date()

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
