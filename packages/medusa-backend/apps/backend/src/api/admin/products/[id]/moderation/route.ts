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

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const product = await loadProduct(req)
  if (!product) return fail(res, 404, "Produto não encontrado")

  const pending = pendingChangesOf(product)
  const kind = pending ? "change" : product.status === "proposed" ? "new" : null
  // The admin product page loads the product without variants, so the widget
  // gets the live ("before") values from here.
  const variant = product.variants?.[0]
  const brl = variant?.prices?.find((p: any) => p.currency_code === "brl")
  const hasDims = variant && [variant.weight, variant.length, variant.width, variant.height].every((x) => typeof x === "number")
  res.json({
    kind,
    pendingChanges: pending,
    current: {
      title: product.title ?? null,
      description: product.description ?? null,
      thumbnail: product.thumbnail ?? null,
      categoryId: product.categories?.[0]?.id ?? null,
      price: brl?.amount ?? null,
      packageSize: product.metadata?.package_size ?? null,
      packageDimensions: hasDims
        ? { weight: variant.weight, length: variant.length, width: variant.width, height: variant.height }
        : null,
    },
    seller: { name: product.seller?.name ?? null, phone: product.seller?.phone ?? null },
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const product = await loadProduct(req)
  if (!product) return fail(res, 404, "Produto não encontrado")

  const pending = pendingChangesOf(product)

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

  if (product.status === "proposed") {
    // approved_at and the seller notice come from the product.updated subscriber.
    await updateProductsWorkflow(req.scope).run({
      input: { products: [{ id: product.id, status: "published" }] },
    })
    return res.json({ ok: true })
  }

  return fail(res, 409, "Nada para aprovar")
}
