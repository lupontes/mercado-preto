import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const [seller] = await sellerService.listSellers({ id })
  if (!seller || seller.status === "suspended") {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  res.json({
    seller: {
      id: seller.id,
      name: seller.name,
      bio: seller.bio,
      location: seller.location,
      category: seller.category,
      status: seller.status,
    },
  })
}
