import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "../../../modules/seller"
import { categoryExists } from "./category-validation"
import { resolveSellerPackage } from "./package"
import { notifyTeamProductSubmitted } from "../../../utils/product-moderation-notify"

const packageFields = {
  packageSize: z.enum(["small", "medium", "large", "bulky"]).optional(),
  packageDimensions: z
    .object({ weight: z.number().positive(), length: z.number().positive(), width: z.number().positive(), height: z.number().positive() })
    .optional(),
}

const CreateProductSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  handle: z.string().optional(),
  thumbnail: z.string().url().optional(),
  status: z.enum(["draft", "proposed"]).default("draft"),
  category_id: z.string().optional(),
  variants: z.array(z.object({
    title: z.string().default("Default"),
    sku: z.string().optional(),
    prices: z.array(z.object({
      amount: z.number().int().positive(),
      currency_code: z.string().length(3).default("brl"),
    })).default([]),
  })).default([{ title: "Default", prices: [] }]),
  ...packageFields,
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
      "products.metadata",
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

  const pkg = resolveSellerPackage(parsed.data.packageSize ?? "medium", parsed.data.packageDimensions)
  if (!pkg.ok) return res.status(400).json({ error: pkg.error })

  const productService = req.scope.resolve(Modules.PRODUCT)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  if (parsed.data.category_id && !(await categoryExists(productService, parsed.data.category_id))) {
    return res.status(400).json({ error: "Categoria não encontrada" })
  }

  const isSubmission = parsed.data.status === "proposed"
  // Records when the review started, so managers can tell how long a product has waited.
  const metadata = isSubmission
    ? { ...pkg.metadata, submitted_at: new Date().toISOString() }
    : pkg.metadata

  let product: any
  try {
    // productService.createProducts() never touches the Pricing module, so
    // variant prices would be silently dropped — the workflow orchestrates
    // both the Product and Pricing modules together.
    const { result: [created] } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [{
          title: parsed.data.title,
          description: parsed.data.description,
          handle: parsed.data.handle,
          thumbnail: parsed.data.thumbnail,
          status: parsed.data.status as any,
          category_ids: parsed.data.category_id ? [parsed.data.category_id] : undefined,
          metadata,
          // The seller panel only creates single-variant products (no option
          // picker in the UI), so every variant gets the same fixed option.
          options: [{ title: "Default", values: ["Default"] }],
          variants: parsed.data.variants.map((v: any) => ({
            title: v.title,
            ...pkg.dims,
            ...(v.sku ? { sku: v.sku } : {}),
            prices: v.prices,
            options: { Default: "Default" },
          })),
        }],
      },
    })
    product = created
  } catch (err: any) {
    console.error("[seller/products POST] createProductsWorkflow error:", err?.message)
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

  if (isSubmission) {
    // Alert only after the store link exists; a failed alert must not turn a
    // successfully created product into an error response.
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: [seller] } = await query.graph({
        entity: "seller",
        fields: ["id", "name"],
        filters: { id: sellerId },
      })
      await notifyTeamProductSubmitted(
        { id: product.id, title: product.title, handle: product.handle },
        seller?.name ?? "",
        "new"
      )
    } catch (err: any) {
      console.error("[seller/products POST] notifyTeamProductSubmitted error:", err?.message)
    }
  }

  res.status(201).json({ product })
}
