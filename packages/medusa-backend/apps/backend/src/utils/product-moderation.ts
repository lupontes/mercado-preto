import { resolvePackageDimensions, type PackageDimensions, type PackageSize } from "./package-size"

type Price = { amount: number; currency_code: string }

/** Same shape as the seller's PATCH body, minus `status`. */
export type SellerProductChanges = {
  title?: string
  description?: string
  thumbnail?: string
  category_id?: string | null
  variants?: { id: string; prices: Price[] }[]
  packageSize?: PackageSize
  packageDimensions?: PackageDimensions
}

export type LiveProduct = {
  status: string
  title: string
  description: string | null
  thumbnail: string | null
  metadata: Record<string, unknown> | null
  categories?: { id: string }[]
  variants?: {
    id: string
    length?: number | null
    width?: number | null
    height?: number | null
    weight?: number | null
    prices?: Price[]
  }[]
}

/** A product that was approved once stays live-editable; only edits go back to review. */
export function isApproved(p: Pick<LiveProduct, "status" | "metadata">): boolean {
  return p.status === "published" || !!p.metadata?.approved_at
}

function brlAmount(prices?: Price[]): number | undefined {
  return prices?.find((x) => x.currency_code === "brl")?.amount
}

function sameDimensions(a: { [K in keyof PackageDimensions]?: number | null }, b: PackageDimensions): boolean {
  return Number(a.length) === b.length && Number(a.width) === b.width && Number(a.height) === b.height && Number(a.weight) === b.weight
}

function matchesVariantDimensions(live: LiveProduct, size: PackageSize, custom?: PackageDimensions): boolean {
  try {
    return sameDimensions(live.variants?.[0] ?? {}, resolvePackageDimensions(size, custom))
  } catch {
    // Bulky without valid measures cannot match anything.
    return false
  }
}

/**
 * Pure: keeps only the keys whose submitted value differs from the live product.
 * The seller form resubmits every field, so unchanged ones must not trigger a new review.
 */
export function diffSellerChanges(live: LiveProduct, submitted: SellerProductChanges): SellerProductChanges {
  const diff: SellerProductChanges = {}

  if (submitted.title !== undefined && submitted.title !== live.title) diff.title = submitted.title
  // Empty string and null both mean "no text" for the storefront.
  if (submitted.description !== undefined && (submitted.description || null) !== (live.description || null)) {
    diff.description = submitted.description
  }
  if (submitted.thumbnail !== undefined && (submitted.thumbnail || null) !== (live.thumbnail || null)) {
    diff.thumbnail = submitted.thumbnail
  }
  if (submitted.category_id !== undefined && submitted.category_id !== (live.categories?.[0]?.id ?? null)) {
    diff.category_id = submitted.category_id
  }

  if (submitted.variants) {
    const changed = submitted.variants.filter((sv) => {
      const lv = live.variants?.find((v) => v.id === sv.id)
      return !lv || brlAmount(sv.prices) !== brlAmount(lv.prices)
    })
    if (changed.length) diff.variants = changed
  }

  if (submitted.packageSize !== undefined) {
    const dims = submitted.packageDimensions
    const liveSize = live.metadata?.package_size
    // Older/imported products have no stored preset: compare the measures the
    // submitted size resolves to against the variant instead of flagging a change.
    const sizeChanged = liveSize ? submitted.packageSize !== liveSize : !matchesVariantDimensions(live, submitted.packageSize, dims)
    const dimsChanged =
      submitted.packageSize === "bulky" && !!dims && !sameDimensions(live.variants?.[0] ?? {}, dims)
    // Size and dimensions travel together so a bulky change can be applied atomically.
    if (sizeChanged || dimsChanged) {
      diff.packageSize = submitted.packageSize
      if (submitted.packageSize === "bulky" && dims) diff.packageDimensions = dims
    }
  }

  return diff
}

export function pendingChangesOf(
  p: Pick<LiveProduct, "metadata">
): (SellerProductChanges & { submittedAt: string }) | null {
  const pending = p.metadata?.pending_changes
  return pending ? (pending as SellerProductChanges & { submittedAt: string }) : null
}
