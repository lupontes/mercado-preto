import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../modules/seller"

const UpdateProductSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().optional(),
  thumbnail: z.string().url().optional(),
  status: z.enum(["draft", "published"]).optional(),
})

async function getSellerProduct(req: MedusaRequest, sellerId: string, productId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["products.id"],
    filters: { id: sellerId },
  })
  const products = sellers?.[0]?.products ?? []
  return products.find((p: any) => p.id === productId)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params

  const linked = await getSellerProduct(req, sellerId, id)
  if (!linked) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  const productService = req.scope.resolve(Modules.PRODUCT)
  const [product] = await productService.listProducts({ id: [id] })
  res.json({ product })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params

  const linked = await getSellerProduct(req, sellerId, id)
  if (!linked) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  const parsed = UpdateProductSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const productService = req.scope.resolve(Modules.PRODUCT)
  const product = await productService.updateProducts(id, parsed.data as any)
  res.json({ product })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params

  const linked = await getSellerProduct(req, sellerId, id)
  if (!linked) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)
  await remoteLink.dismiss([{
    [SELLER_MODULE]: { seller_id: sellerId },
    [Modules.PRODUCT]: { product_id: id },
  }])

  res.json({ message: "Produto removido da loja" })
}
