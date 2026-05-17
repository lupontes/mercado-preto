import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { PAYOUT_MODULE } from "../../../modules/payout"
import PayoutModuleService from "../../../modules/payout/service"

const CreatePayoutSchema = z.object({
  sellerId: z.string(),
  amount: z.number().int().positive(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const { seller_id, status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status

  const payouts = await payoutService.listPayouts(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  const total = payouts.reduce((acc, p) => acc + Number(p.amount), 0)
  res.json({ payouts, total, count: payouts.length })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)

  const parsed = CreatePayoutSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const payout = await payoutService.createPayouts({
    ...parsed.data,
    periodStart: new Date(parsed.data.periodStart),
    periodEnd: new Date(parsed.data.periodEnd),
  })

  res.status(201).json({ payout })
}
