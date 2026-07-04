import { toHandle } from "@medusajs/framework/utils"

/**
 * Fallback slugifier used only when Nuvemshop provided no handle at all, so we
 * still have a base string to suffix. Delegates to Medusa's own toHandle so
 * accented titles (e.g. "Luminária") produce the same accent-stripped slug
 * Medusa's own auto-handle logic would, instead of dropping the accented
 * character entirely. toHandle doesn't trim leading/trailing hyphens, so that
 * is done here to avoid a double hyphen once the collision suffix is appended.
 */
export function slugifyTitle(title: string): string {
  return toHandle(title).replace(/^-+|-+$/g, "")
}

/**
 * The source Nuvemshop store has a handful of products that legitimately
 * duplicate a handle or a variant SKU (same value reused across two different
 * Nuvemshop products). Medusa enforces store-wide uniqueness on both, so
 * `createProductsWorkflow` throws one of these two exact messages — we match
 * on the stable, non-parameterized parts of each ("Product with handle:" /
 * "Product variant with sku:" + "already exists.") via `includes` rather than
 * a full-string regex, since that's forgiving of whatever gets interpolated
 * in the middle and of any wrapping the workflow engine might add around the
 * message, while still not matching unrelated errors.
 */
export function isDuplicateHandleOrSkuError(message?: string): boolean {
  if (!message) return false
  return (
    (message.includes("Product with handle:") && message.includes("already exists.")) ||
    (message.includes("Product variant with sku:") && message.includes("already exists."))
  )
}
