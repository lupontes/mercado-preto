import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { PAYOUT_MODULE } from "../../../modules/payout"
import { COMMISSION_MODULE } from "../../../modules/commission"
import { SELLER_MODULE } from "../../../modules/seller"
import PayoutModuleService from "../../../modules/payout/service"
import CommissionModuleService from "../../../modules/commission/service"
import SellerModuleService from "../../../modules/seller/service"

const CreatePayoutSchema = z.object({
  sellerId: z.string(),
  amount: z.number().int().positive(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { seller_id, status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status

  const payouts = await payoutService.listPayouts(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const allMatching = await payoutService.listPayouts(filters)
  const count = allMatching.length
  const total = allMatching.reduce((acc: number, p: any) => acc + Number(p.amount), 0)

  const sellerIds = [...new Set(payouts.map((p: any) => p.sellerId))]
  const sellers = sellerIds.length > 0 ? await sellerService.listSellers({ id: sellerIds }) : []
  const sellerNameById = new Map(sellers.map((s: any) => [s.id, s.name]))

  const enrichedPayouts = payouts.map((p: any) => ({
    ...p,
    sellerName: sellerNameById.get(p.sellerId) ?? "Vendedor removido",
  }))

  res.json({ payouts: enrichedPayouts, total, count, limit: Number(limit), offset: Number(offset) })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)

  const parsed = CreatePayoutSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const periodStart = new Date(parsed.data.periodStart)
  const periodEnd = new Date(parsed.data.periodEnd)

  const payout = await payoutService.createPayouts({
    ...parsed.data,
    periodStart,
    periodEnd,
  })

  await commissionService.linkPendingToPayout(parsed.data.sellerId, periodStart, periodEnd, payout.id)

  res.status(201).json({ payout })
}
