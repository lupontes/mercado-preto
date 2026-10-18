import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params
  const { limit = 20, offset = 0 } = req.query as Record<string, string>

  const [seller] = await sellerService.listSellers({ id })
  // Same rule as the public store list: only active stores are visible.
  if (!seller || seller.status !== "active") {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: [
      "id",
      "products.id",
      "products.title",
      "products.handle",
      "products.thumbnail",
      "products.status",
      "products.description",
    ],
    filters: { id },
  })

  // Drafts are the seller's work in progress and never public.
  const products = (sellers?.[0]?.products ?? []).filter((p: any) => p?.status === "published")
  const paginated = products.slice(Number(offset), Number(offset) + Number(limit))

  res.json({ products: paginated, count: products.length, limit: Number(limit), offset: Number(offset) })
}
