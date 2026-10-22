import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../modules/seller"
import { applySellerProductUpdate } from "../apply-update"

const packageFields = {
  packageSize: z.enum(["small", "medium", "large", "bulky"]).optional(),
  packageDimensions: z
    .object({ weight: z.number().positive(), length: z.number().positive(), width: z.number().positive(), height: z.number().positive() })
    .optional(),
}

const UpdateProductSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().optional(),
  thumbnail: z.string().url().optional(),
  status: z.enum(["draft", "published"]).optional(),
  category_id: z.string().nullable().optional(),
  variants: z.array(z.object({
    id: z.string(),
    prices: z.array(z.object({
      amount: z.number().int().positive(),
      currency_code: z.string().length(3),
    })),
  })).optional(),
  ...packageFields,
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

  // productService.listProducts({ relations: [...] }) throws on the nested
  // "variants.prices" relation in this Medusa version (MikroORM bug in
  // getJoinedFilters), so we use the remote query instead, same as the list route.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "description",
      "thumbnail",
      "status",
      "metadata",
      "categories.id",
      "categories.name",
      "variants.id",
      "variants.weight",
      "variants.length",
      "variants.width",
      "variants.height",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: { id },
  })
  res.json({ product: products?.[0] })
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

  // Zod omits absent keys but keeps an explicit null, so "category_id" in parsed.data
  // keeps the three states: absent (don't touch), null (clear), string (set).
  const result = await applySellerProductUpdate(req.scope, id, parsed.data)
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  const product = result.product
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
