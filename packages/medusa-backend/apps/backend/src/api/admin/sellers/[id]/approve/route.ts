import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const [existing] = await sellerService.listSellers({ id })
  if (!existing) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  const seller = await sellerService.approveSeller(id)
  res.json({ seller })
}
