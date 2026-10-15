import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"
import { hasShippingOrigin } from "../../../../../utils/seller-address"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const [existing] = await sellerService.listSellers({ id })
  if (!existing) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  if (!hasShippingOrigin(existing as any)) {
    return res.status(400).json({ error: "Preencha o endereço de envio antes de aprovar" })
  }

  const seller = await sellerService.approveSeller(id)

  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  await eventBus.emit({ name: "seller.approved", data: { id: seller.id } })

  res.json({ seller })
}
