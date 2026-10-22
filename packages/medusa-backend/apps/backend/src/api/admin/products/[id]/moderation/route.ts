import { createHash } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { applySellerProductUpdate } from "../../../../seller/products/apply-update"
import { pendingChangesOf } from "../../../../../utils/product-moderation"
import { notifySellerProductApproved } from "../../../../../utils/product-moderation-notify"

async function loadProduct(req: MedusaRequest) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: [product] } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status", "metadata", "description", "thumbnail", "categories.id",
      "variants.weight", "variants.length", "variants.width", "variants.height",
      "variants.prices.amount", "variants.prices.currency_code", "seller.name", "seller.phone", "seller.email"],
    filters: { id: req.params.id },
  })
  return product as any
}

// Medusa's FetchError message comes from `message`, not `error`, so both are sent.
function fail(res: MedusaResponse, status: number, text: string) {
  return res.status(status).json({ error: text, message: text })
}

// The live values the widget shows; the admin product page loads the product
// without variants, so the widget gets them ("before" values) from here.
function currentValues(product: any) {
  const variant = product.variants?.[0]
  const brl = variant?.prices?.find((p: any) => p.currency_code === "brl")
  const hasDims = variant && [variant.weight, variant.length, variant.width, variant.height].every((x) => typeof x === "number")
  return {
    title: product.title ?? null,
    description: product.description ?? null,
    thumbnail: product.thumbnail ?? null,
    categoryId: product.categories?.[0]?.id ?? null,
    price: brl?.amount ?? null,
    packageSize: product.metadata?.package_size ?? null,
    packageDimensions: hasDims
      ? { weight: variant.weight, length: variant.length, width: variant.width, height: variant.height }
      : null,
  }
}

/**
 * Identifies the version the manager is looking at, so approval can refuse a
 * newer one the seller saved meanwhile. A change uses its `submittedAt`, which
 * the seller PATCH renews whenever the pending diff changes. A new product
 * uses a fingerprint of the values shown: the seller edits a product in review
 * in place without renewing `submitted_at`, and a price- or measure-only edit
 * touches only variant rows, so neither `submitted_at` nor the product's
 * `updated_at` would reliably change.
 */
function reviewVersion(product: any, pending: ReturnType<typeof pendingChangesOf>): string | null {
  if (pending) return pending.submittedAt ?? null
  if (product.status !== "proposed") return null
  return createHash("sha256").update(JSON.stringify(currentValues(product))).digest("hex")
}

const STALE_REVIEW = "A vendedora alterou o produto. Recarregue e confira de novo."

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const product = await loadProduct(req)
  if (!product) return fail(res, 404, "Produto não encontrado")

  const pending = pendingChangesOf(product)
  const kind = pending ? "change" : product.status === "proposed" ? "new" : null
  res.json({
    kind,
    pendingChanges: pending,
    version: reviewVersion(product, pending),
    current: currentValues(product),
    seller: { name: product.seller?.name ?? null, phone: product.seller?.phone ?? null },
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const product = await loadProduct(req)
  if (!product) return fail(res, 404, "Produto não encontrado")

  const pending = pendingChangesOf(product)
  const version = reviewVersion(product, pending)
  if (version === null) return fail(res, 409, "Nada para aprovar")

  // Approving must apply exactly what the manager reviewed; a missing version
  // (an old, cached widget) is treated as stale too.
  const seen = (req.body as { version?: unknown } | undefined)?.version
  if (typeof seen !== "string" || seen !== version) return fail(res, 409, STALE_REVIEW)

  if (pending) {
    // Destructure instead of assigning undefined: an explicit `category_id: undefined`
    // would be read as "clear the category".
    const { submittedAt: _submittedAt, ...changes } = pending
    const result = await applySellerProductUpdate(req.scope, product.id, changes, { pending_changes: null })
    if (!result.ok) return fail(res, 409, result.error)

    try {
      await notifySellerProductApproved(
        { name: product.seller?.name, phone: product.seller?.phone, email: product.seller?.email },
        { id: product.id, title: product.title, handle: product.handle },
        "change",
      )
    } catch (err) {
      // The approval is already saved; a failed notice must not turn it into an error.
      console.error(`[product-moderation] falha ao avisar a vendedora (${product.id}): ${err}`)
    }
    return res.json({ ok: true })
  }

  // Only a proposed product gets here (reviewVersion is null otherwise).
  // approved_at and the seller notice come from the product.updated subscriber.
  await updateProductsWorkflow(req.scope).run({
    input: { products: [{ id: product.id, status: "published" }] },
  })
  return res.json({ ok: true })
}
