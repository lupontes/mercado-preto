/**
 * Fallback slugifier used only when Nuvemshop provided no handle at all, so we
 * still have a base string to suffix. Mirrors the general shape of Medusa's own
 * auto-slugify (lowercase, non-alphanumeric runs collapsed to a single hyphen,
 * no leading/trailing hyphens) — it doesn't need to be identical, just sane.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
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
