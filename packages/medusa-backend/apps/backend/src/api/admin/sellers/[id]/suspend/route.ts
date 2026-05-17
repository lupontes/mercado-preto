import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

const SuspendSchema = z.object({
  reason: z.string().optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const parsed = SuspendSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos" })
  }

  const [existing] = await sellerService.listSellers({ id })
  if (!existing) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  const seller = await sellerService.suspendSeller(id, parsed.data.reason)
  res.json({ seller })
}
