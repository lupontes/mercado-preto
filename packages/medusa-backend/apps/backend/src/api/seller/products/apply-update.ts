import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { SellerProductChanges } from "../../../utils/product-moderation"
import { categoryExists } from "./category-validation"
import { resolveSellerPackage } from "./package"

export type ApplySellerProductUpdateResult =
  | { ok: true; product: any }
  | { ok: false; status: 400; error: string }

/**
 * Applies a seller's product edit. Takes only the container (no request) so the
 * seller PATCH and the admin approval can share it.
 * `extraMetadata` is merged over the current metadata; a `null` value removes the key.
 * Removal is sent as `""`: Medusa's product repository runs `mergeMetadata` on update,
 * which keeps every stored key absent from the new object and only drops keys set to "".
 */
export async function applySellerProductUpdate(
  scope: MedusaContainer,
  productId: string,
  changes: SellerProductChanges & { status?: "draft" | "proposed" | "published" },
  extraMetadata?: Record<string, unknown>,
): Promise<ApplySellerProductUpdateResult> {
  const productService = scope.resolve(Modules.PRODUCT) as any

  const { category_id, packageSize, packageDimensions, ...rest } = changes
  const updateData: Record<string, unknown> = { ...rest }

  // Three states: key absent (don't touch), null (clear), string (set). Callers must
  // leave the key out entirely, not set it to undefined, when there is no category change.
  if ("category_id" in changes) {
    if (category_id === "") {
      return { ok: false, status: 400, error: "category_id não pode ser uma string vazia; use null para limpar a categoria" }
    }
    if (category_id && !(await categoryExists(productService, category_id))) {
      return { ok: false, status: 400, error: "Categoria não encontrada" }
    }
    updateData.category_ids = category_id ? [category_id] : []
  }

  let packageMetadata: Record<string, unknown> | undefined
  if (packageSize) {
    const pkg = resolveSellerPackage(packageSize, packageDimensions)
    if (!pkg.ok) return { ok: false, status: 400, error: pkg.error }
    packageMetadata = pkg.metadata
    await productService.updateProductVariants({ product_id: productId }, pkg.dims)
  }

  if (packageMetadata || extraMetadata) {
    // Read once: both the package change and extraMetadata merge onto the same base.
    const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: [current] } = await query.graph({ entity: "product", fields: ["id", "metadata"], filters: { id: productId } })
    const merged: Record<string, unknown> = { ...((current?.metadata ?? {}) as Record<string, unknown>), ...packageMetadata }
    for (const [key, value] of Object.entries(extraMetadata ?? {})) {
      // Deleting the key here would be a no-op: the stored value would survive the merge.
      merged[key] = value === null ? "" : value
    }
    updateData.metadata = merged
  }

  if (changes.variants) {
    // Medusa's product repository replaces the whole variants collection on
    // update, so a partial list (the portal only edits the first variant) would
    // delete the others. Listing them by id alone keeps them unchanged.
    const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: [live] } = await query.graph({ entity: "product", fields: ["id", "variants.id"], filters: { id: productId } })
    const listed = new Set(changes.variants.map((v) => v.id))
    const unlisted = ((live?.variants ?? []) as { id: string }[])
      .filter((v) => !listed.has(v.id))
      .map((v) => ({ id: v.id }))
    updateData.variants = [...changes.variants, ...unlisted]
  }

  // Not the selector form: there Medusa's update step selects the previous state using
  // the update's keys, and "category_ids" is not a Product column, so every edit failed.
  const { result: [product] } = await updateProductsWorkflow(scope).run({
    input: { products: [{ id: productId, ...updateData } as any] },
  })
  return { ok: true, product }
}
