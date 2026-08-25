export const GENERIC_CATEGORY_NAMES = ["Produtos MAB"]

interface RemoteQueryLike {
  graph: (args: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: any[] }>
}

function isValidNcm(value: unknown): value is string {
  return typeof value === "string" && /^\d{8}$/.test(value)
}

/**
 * Resolves the NCM (fiscal product-type code) for a sold variant by walking
 * variant -> product -> categories. The most specific category wins: generic
 * catch-all buckets (GENERIC_CATEGORY_NAMES) are ignored unless they're the
 * only category present, and ties between specific categories are broken
 * alphabetically by name (query.graph doesn't guarantee return order).
 *
 * Never throws — any failure (missing variant, query error, no NCM anywhere)
 * resolves to undefined, so callers can fall back to a safe default instead
 * of blocking fiscal emission.
 */
export async function resolveNcmForVariant(
  query: RemoteQueryLike,
  variantId: string
): Promise<string | undefined> {
  try {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["product.categories.name", "product.categories.metadata"],
      filters: { id: variantId },
    })

    const categories: Array<{ name: string; metadata?: Record<string, unknown> }> =
      data?.[0]?.product?.categories ?? []

    const specific = categories
      .filter((category) => !GENERIC_CATEGORY_NAMES.includes(category.name))
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const category of specific) {
      const ncm = category.metadata?.ncm
      if (isValidNcm(ncm)) return ncm
    }

    return undefined
  } catch {
    return undefined
  }
}
