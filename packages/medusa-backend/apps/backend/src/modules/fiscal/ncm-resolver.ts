// Keyed by category `name`, which is mutable and admin-editable. Renaming a
// category in the Medusa admin (e.g. "Produtos MAB" -> "Produtos MAB ") will
// silently un-skip it from generic-category handling until this list is
// updated to match the new name.
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
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))

    for (const category of specific) {
      const ncm = category.metadata?.ncm
      if (isValidNcm(ncm)) return ncm
    }

    return undefined
  } catch (err) {
    // A systemic failure (bad query shape, DB error, renamed Medusa entity
    // after an upgrade) would otherwise be indistinguishable from "this
    // category legitimately has no NCM yet" — log it so it's at least
    // visible somewhere, without breaking the no-throw contract.
    console.warn(`[ncm-resolver] falha ao resolver NCM de ${variantId}`, err)
    return undefined
  }
}

export interface RawFiscalItem {
  title: string
  quantity: number
  unit_price?: number
  variant_id?: string
}

export interface ResolvedFiscalItem {
  description: string
  quantity: number
  unitPrice: number
  ncm?: string
}

/**
 * Resolves the NCM for each raw order item and builds the item list consumed
 * by EmitNfeInput.items, alongside a single ncmFallbackUsed flag that's true
 * if any item couldn't be resolved (missing variant_id or no category NCM).
 * Shared by order-fiscal-emit.ts and the admin retry route so both emission
 * paths build fiscal items identically.
 */
export async function buildFiscalItems(
  query: RemoteQueryLike,
  rawItems: RawFiscalItem[]
): Promise<{ items: ResolvedFiscalItem[]; ncmFallbackUsed: boolean }> {
  let ncmFallbackUsed = false
  const items = await Promise.all(
    rawItems.map(async (item) => {
      const ncm = item.variant_id
        ? await resolveNcmForVariant(query, item.variant_id)
        : undefined
      if (!ncm) ncmFallbackUsed = true
      return {
        description: item.title,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price ?? 0),
        ncm,
      }
    })
  )
  return { items, ncmFallbackUsed }
}
