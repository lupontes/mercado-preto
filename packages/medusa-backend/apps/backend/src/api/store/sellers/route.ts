import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "../../../modules/seller"
import SellerModuleService from "../../../modules/seller/service"
import { toPublicSeller } from "../../../utils/public-seller"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { category, location, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters: Record<string, string> = { status: "active" }
  if (category) filters.category = category
  if (location) filters.location = location

  const sellers = await sellerService.listSellers(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })
  const count = await sellerService.listSellers(filters).then((s) => s.length)

  const publicSellers = sellers.map(toPublicSeller)

  res.json({ sellers: publicSellers, count, limit: Number(limit), offset: Number(offset) })
}
