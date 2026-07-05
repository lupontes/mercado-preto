import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../modules/seller"
import { categoryExists } from "./category-validation"

const CreateProductSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  handle: z.string().optional(),
  thumbnail: z.string().url().optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  category_id: z.string().optional(),
  variants: z.array(z.object({
    title: z.string().default("Default"),
    sku: z.string().optional(),
    prices: z.array(z.object({
      amount: z.number().int().positive(),
      currency_code: z.string().length(3).default("brl"),
    })).default([]),
  })).default([{ title: "Default", prices: [] }]),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { limit = 20, offset = 0 } = req.query as Record<string, string>

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
      "products.created_at",
      "products.categories.id",
      "products.categories.name",
      "products.variants.id",
      "products.variants.prices.amount",
      "products.variants.prices.currency_code",
    ],
    filters: { id: sellerId },
  })

  const products = sellers?.[0]?.products ?? []
  const paginated = products.slice(Number(offset), Number(offset) + Number(limit))
  res.json({ products: paginated, count: products.length, limit: Number(limit), offset: Number(offset) })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId

  const parsed = CreateProductSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const productService = req.scope.resolve(Modules.PRODUCT)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  if (parsed.data.category_id && !(await categoryExists(productService, parsed.data.category_id))) {
    return res.status(400).json({ error: "Categoria não encontrada" })
  }

  let product: any
  try {
    const [created] = await productService.createProducts([{
      title: parsed.data.title,
      description: parsed.data.description,
      handle: parsed.data.handle,
      thumbnail: parsed.data.thumbnail,
      status: parsed.data.status as any,
      category_ids: parsed.data.category_id ? [parsed.data.category_id] : undefined,
      variants: parsed.data.variants.map((v: any) => ({
        title: v.title,
        ...(v.sku ? { sku: v.sku } : {}),
      })),
    }])
    product = created
  } catch (err: any) {
    console.error("[seller/products POST] createProducts error:", err?.message)
    return res.status(500).json({ error: "Erro ao criar produto", details: err?.message })
  }

  try {
    await remoteLink.create([{
      [SELLER_MODULE]: { seller_id: sellerId },
      [Modules.PRODUCT]: { product_id: product.id },
    }])
  } catch (err: any) {
    return res.status(500).json({ error: "Produto criado mas vínculo falhou", productId: product.id, details: err?.message })
  }

  res.status(201).json({ product })
}
