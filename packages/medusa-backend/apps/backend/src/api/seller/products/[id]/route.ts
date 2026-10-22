import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../modules/seller"
import { isDeepStrictEqual } from "node:util"
import { applySellerProductUpdate } from "../apply-update"
import { categoryExists } from "../category-validation"
import { resolveSellerPackage } from "../package"
import {
  diffSellerChanges,
  isApproved,
  pendingChangesOf,
  type LiveProduct,
  type SellerProductChanges,
} from "../../../../utils/product-moderation"
import { notifyTeamProductSubmitted } from "../../../../utils/product-moderation-notify"

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
  status: z.enum(["draft", "proposed", "published"]).optional(),
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

// productService.listProducts({ relations: [...] }) throws on the nested
// "variants.prices" relation in this Medusa version (MikroORM bug in
// getJoinedFilters), so we use the remote query instead, same as the list route.
const LIVE_PRODUCT_FIELDS = [
  "id",
  "handle",
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
]

async function loadLiveProduct(req: MedusaRequest, id: string): Promise<(LiveProduct & { id: string; handle: string }) | undefined> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({ entity: "product", fields: LIVE_PRODUCT_FIELDS, filters: { id } })
  return products?.[0] as any
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params

  const linked = await getSellerProduct(req, sellerId, id)
  if (!linked) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  const product = await loadLiveProduct(req, id)
  // The portal edits the pending version when there is one, so it needs both.
  res.json({ product, pendingChanges: product ? pendingChangesOf(product) : null })
}

async function alertManagers(
  req: MedusaRequest,
  sellerId: string,
  product: { id: string; title: string; handle: string },
  kind: "new" | "change",
) {
  // A failed alert must never turn a saved edit into an error response.
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id", "name"], filters: { id: sellerId } })
    await notifyTeamProductSubmitted(
      { id: product.id, title: product.title, handle: product.handle },
      seller?.name ?? "",
      kind,
    )
  } catch (err: any) {
    console.error("[seller/products PATCH] notifyTeamProductSubmitted error:", err?.message)
  }
}

/**
 * A pending edit is only applied at approval time, so reject now what would fail
 * then (bad category, impossible package) instead of leaving managers a dead end.
 */
async function validatePendingChanges(req: MedusaRequest, diff: SellerProductChanges): Promise<string | null> {
  if ("category_id" in diff) {
    if (diff.category_id === "") return "category_id não pode ser uma string vazia; use null para limpar a categoria"
    const productService = req.scope.resolve(Modules.PRODUCT) as any
    if (diff.category_id && !(await categoryExists(productService, diff.category_id))) return "Categoria não encontrada"
  }
  if (diff.packageSize) {
    const pkg = resolveSellerPackage(diff.packageSize, diff.packageDimensions)
    if (!pkg.ok) return pkg.error
  }
  return null
}

function withoutSubmittedAt(pending: (SellerProductChanges & { submittedAt?: string }) | null) {
  if (!pending) return null
  const { submittedAt: _submittedAt, ...changes } = pending
  return changes
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

  const live = await loadLiveProduct(req, id)
  if (!live) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  // Address the product by the route id, the one the seller link was checked against.
  const product = { ...live, id }
  if (!isApproved(product)) return patchUnapproved(req, res, sellerId, product, parsed.data)
  return patchApproved(req, res, sellerId, product, parsed.data)
}

type ParsedUpdate = z.infer<typeof UpdateProductSchema>

async function patchUnapproved(
  req: MedusaRequest,
  res: MedusaResponse,
  sellerId: string,
  live: LiveProduct & { id: string; handle: string },
  data: ParsedUpdate,
) {
  if (data.status === "published") {
    return res.status(400).json({ error: "Produto ainda não aprovado. Envie para análise." })
  }

  // Only the draft -> proposed transition starts a review; editing a product
  // already in review keeps its original place in the queue.
  const isSubmission = live.status === "draft" && data.status === "proposed"
  const extraMetadata = isSubmission ? { submitted_at: new Date().toISOString() } : undefined

  // Zod omits absent keys but keeps an explicit null, so "category_id" in data
  // keeps the three states: absent (don't touch), null (clear), string (set).
  const result = await applySellerProductUpdate(req.scope, live.id, data, extraMetadata)
  if (!result.ok) return res.status(result.status).json({ error: result.error })

  if (isSubmission) {
    await alertManagers(req, sellerId, { id: live.id, title: result.product?.title ?? live.title, handle: live.handle }, "new")
  }
  res.json({ product: result.product, pendingChanges: null })
}

async function patchApproved(
  req: MedusaRequest,
  res: MedusaResponse,
  sellerId: string,
  live: LiveProduct & { id: string; handle: string },
  data: ParsedUpdate,
) {
  const { status, ...content } = data
  if (status === "proposed") {
    return res.status(400).json({ error: "Produto já aprovado não volta para análise." })
  }

  const previous = pendingChangesOf(live)
  let pending = previous
  let isNewChange = false
  const extraMetadata: Record<string, unknown> = {}

  // A status-only body (hide/republish) must leave any pending edit untouched.
  if (Object.keys(content).length > 0) {
    const diff = diffSellerChanges(live, content)
    if (Object.keys(diff).length === 0) {
      pending = null
      if (previous) extraMetadata.pending_changes = null
    } else if (!isDeepStrictEqual(diff, withoutSubmittedAt(previous))) {
      const error = await validatePendingChanges(req, diff)
      if (error) return res.status(400).json({ error })
      pending = { ...diff, submittedAt: new Date().toISOString() }
      extraMetadata.pending_changes = pending
      isNewChange = true
    }
    // Same diff as the stored one: keep its submittedAt so the queue order holds.
  }

  // Products published before moderation existed count as approved; stamp them so
  // they keep that status after being hidden as drafts.
  if (!live.metadata?.approved_at) extraMetadata.approved_at = new Date().toISOString()

  let product: any = live
  const hasMetadata = Object.keys(extraMetadata).length > 0
  if (status !== undefined || hasMetadata) {
    // The content never goes to the live product here: it stays on sale as approved
    // until a manager approves the pending edit.
    const result = await applySellerProductUpdate(
      req.scope,
      live.id,
      status !== undefined ? { status } : {},
      hasMetadata ? extraMetadata : undefined,
    )
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    product = result.product
  }

  if (isNewChange) {
    await alertManagers(req, sellerId, { id: live.id, title: live.title, handle: live.handle }, "change")
  }
  res.json({ product, pendingChanges: pending })
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
