import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

const LinkProductSchema = z.object({ productId: z.string() })

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
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
    ],
    filters: { id },
  })

  const products = sellers?.[0]?.products ?? []
  res.json({ products, count: products.length })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  const parsed = LinkProductSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const [seller] = await sellerService.listSellers({ id })
  if (!seller) return res.status(404).json({ error: "Vendedor não encontrado" })

  await remoteLink.create([{
    [SELLER_MODULE]: { seller_id: id },
    [Modules.PRODUCT]: { product_id: parsed.data.productId },
  }])

  res.json({ message: "Produto vinculado ao vendedor com sucesso" })
}
