import { toHandle } from "@medusajs/framework/utils"
import { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"

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

export type DuplicateCollision = "handle" | "sku" | null

/**
 * The source Nuvemshop store has a handful of products that legitimately
 * duplicate a handle or a variant SKU (same value reused across two different
 * Nuvemshop products). Medusa enforces store-wide uniqueness on both, so
 * `createProductsWorkflow` throws one of these two exact messages — matched on
 * the stable, non-parameterized parts of each ("Product with handle:" /
 * "Product variant with sku:" + "already exists.") via `includes` rather than
 * a full-string regex, since that's forgiving of whatever gets interpolated
 * in the middle and of any wrapping the workflow engine might add around the
 * message, while still not matching unrelated errors. Reporting which field
 * collided (rather than just "a duplicate happened") lets the caller patch
 * only what actually needs it.
 */
export function detectDuplicateCollision(message?: string): DuplicateCollision {
  if (!message) return null
  if (message.includes("Product with handle:") && message.includes("already exists.")) {
    return "handle"
  }
  if (message.includes("Product variant with sku:") && message.includes("already exists.")) {
    return "sku"
  }
  return null
}

/**
 * Builds the retry input for a duplicate-collision: only rewrites the handle
 * when the collision was on the handle, and only rewrites variant SKUs when
 * it was on a SKU. A handle-only collision must not perturb otherwise-correct
 * SKUs, and vice versa.
 */
export function buildCollisionRetryInput(
  input: CreateProductWorkflowInputDTO,
  collision: "handle" | "sku",
  suffix: string | number
): CreateProductWorkflowInputDTO {
  if (collision === "handle") {
    const fallbackHandle = input.handle ?? slugifyTitle(input.title)
    return { ...input, handle: `${fallbackHandle}-${suffix}` }
  }

  return {
    ...input,
    variants: input.variants?.map((variant) =>
      variant.sku ? { ...variant, sku: `${variant.sku}-${suffix}` } : variant
    ),
  }
}
