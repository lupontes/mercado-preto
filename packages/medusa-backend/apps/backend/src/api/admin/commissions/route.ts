import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMISSION_MODULE } from "../../../modules/commission"
import { SELLER_MODULE } from "../../../modules/seller"
import CommissionModuleService from "../../../modules/commission/service"
import SellerModuleService from "../../../modules/seller/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const { seller_id, status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status

  const commissions = await commissionService.listCommissions(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const count = await commissionService.listCommissions(filters).then((all) => all.length)

  const sellerIds = [...new Set(commissions.map((c: any) => c.sellerId))]
  const sellers = sellerIds.length > 0 ? await sellerService.listSellers({ id: sellerIds }) : []
  const sellerNameById = new Map(sellers.map((s: any) => [s.id, s.name]))

  const enrichedCommissions = commissions.map((c: any) => ({
    ...c,
    sellerName: sellerNameById.get(c.sellerId) ?? "Vendedor removido",
  }))

  const totals = commissions.reduce(
    (acc, c) => ({
      grossAmount: acc.grossAmount + Number(c.grossAmount),
      commissionAmount: acc.commissionAmount + Number(c.commissionAmount),
      sellerPayout: acc.sellerPayout + Number(c.sellerPayout),
    }),
    { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 }
  )

  res.json({
    commissions: enrichedCommissions,
    totals,
    count,
    limit: Number(limit),
    offset: Number(offset),
  })
}
