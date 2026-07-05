import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../modules/seller"
import { categoryExists } from "../category-validation"

const UpdateProductSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().optional(),
  thumbnail: z.string().url().optional(),
  status: z.enum(["draft", "published"]).optional(),
  category_id: z.string().nullable().optional(),
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
      "categories.id",
      "categories.name",
      "variants.id",
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

  const productService = req.scope.resolve(Modules.PRODUCT)

  const { category_id, ...rest } = parsed.data
  const updateData: Record<string, unknown> = { ...rest }
  // Zod's .optional() can't tell "key omitted" from "key sent as null" (both parse to undefined-ish),
  // so we check the raw body to get three states: absent (don't touch), null (clear), string (set).
  if (req.body && typeof req.body === "object" && "category_id" in (req.body as Record<string, unknown>)) {
    if (category_id === "") {
      return res.status(400).json({ error: "category_id não pode ser uma string vazia; use null para limpar a categoria" })
    }
    if (category_id && !(await categoryExists(productService, category_id))) {
      return res.status(400).json({ error: "Categoria não encontrada" })
    }
    updateData.category_ids = category_id ? [category_id] : []
  }

  const product = await productService.updateProducts(id, updateData as any)
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
