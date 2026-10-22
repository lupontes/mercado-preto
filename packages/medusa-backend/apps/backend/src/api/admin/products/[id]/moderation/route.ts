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
    fields: ["id", "title", "handle", "status", "metadata", "seller.name", "seller.phone", "seller.email"],
    filters: { id: req.params.id },
  })
  return product as any
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const product = await loadProduct(req)
  if (!product) return res.status(404).json({ error: "Produto não encontrado" })

  const pending = pendingChangesOf(product)
  const kind = pending ? "change" : product.status === "proposed" ? "new" : null
  res.json({
    kind,
    pendingChanges: pending,
    seller: { name: product.seller?.name ?? null, phone: product.seller?.phone ?? null },
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const product = await loadProduct(req)
  if (!product) return res.status(404).json({ error: "Produto não encontrado" })

  const pending = pendingChangesOf(product)

  if (pending) {
    // Destructure instead of assigning undefined: an explicit `category_id: undefined`
    // would be read as "clear the category".
    const { submittedAt: _submittedAt, ...changes } = pending
    const result = await applySellerProductUpdate(req.scope, product.id, changes, { pending_changes: null })
    if (!result.ok) return res.status(409).json({ error: result.error })

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

  return res.status(409).json({ error: "Nada para aprovar" })
}
