import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FISCAL_MODULE } from "../../../modules/fiscal"
import FiscalModuleService from "../../../modules/fiscal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const fiscalService: FiscalModuleService = req.scope.resolve(FISCAL_MODULE)
  const { seller_id, status, order_id, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = {}
  if (seller_id) filters.sellerId = seller_id
  if (status) filters.status = status
  if (order_id) filters.orderId = order_id

  const docs = await fiscalService.listNfDocuments(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })

  res.json({ documents: docs, count: docs.length })
}
