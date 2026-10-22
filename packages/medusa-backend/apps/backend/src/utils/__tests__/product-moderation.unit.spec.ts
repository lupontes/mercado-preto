import { diffSellerChanges, isApproved, pendingChangesOf, type LiveProduct } from "../product-moderation"

describe("isApproved", () => {
  it("is true for published", () => expect(isApproved({ status: "published", metadata: null })).toBe(true))
  it("is true for a draft with approved_at", () =>
    expect(isApproved({ status: "draft", metadata: { approved_at: "2026-10-22T10:00:00Z" } })).toBe(true))
  it("is false for draft and proposed without approved_at", () => {
    expect(isApproved({ status: "draft", metadata: {} })).toBe(false)
    expect(isApproved({ status: "proposed", metadata: null })).toBe(false)
  })
})

describe("diffSellerChanges", () => {
  const live: LiveProduct = {
    status: "published", title: "Colar", description: "Búzios", thumbnail: "https://x/a.jpg",
    metadata: { package_size: "small" }, categories: [{ id: "cat_1" }],
    variants: [{ id: "var_1", prices: [{ amount: 5000, currency_code: "brl" }] }],
  }
  it("returns {} when the full form is resubmitted unchanged", () => {
    expect(diffSellerChanges(live, {
      title: "Colar", description: "Búzios", thumbnail: "https://x/a.jpg", category_id: "cat_1",
      variants: [{ id: "var_1", prices: [{ amount: 5000, currency_code: "brl" }] }],
    })).toEqual({})
  })
  it("keeps only changed keys", () => {
    expect(diffSellerChanges(live, { title: "Colar novo", thumbnail: "https://x/a.jpg",
      variants: [{ id: "var_1", prices: [{ amount: 6000, currency_code: "brl" }] }] }))
      .toEqual({ title: "Colar novo", variants: [{ id: "var_1", prices: [{ amount: 6000, currency_code: "brl" }] }] })
  })
  it("treats undefined description and empty string as equal to null", () => {
    expect(diffSellerChanges({ ...live, description: null }, { description: undefined })).toEqual({})
    expect(diffSellerChanges({ ...live, description: null }, { description: "" })).toEqual({})
  })
  it("detects a category cleared with null", () => {
    expect(diffSellerChanges(live, { category_id: null })).toEqual({ category_id: null })
  })
  it("detects a package size change and ignores the same preset", () => {
    expect(diffSellerChanges(live, { packageSize: "small" })).toEqual({})
    expect(diffSellerChanges(live, { packageSize: "medium" })).toEqual({ packageSize: "medium" })
  })
  it("compares measures when the live product has no package_size", () => {
    const small = { length: 16, width: 11, height: 6, weight: 0.3 }
    const legacy = { ...live, metadata: {}, variants: [{ ...live.variants![0], ...small }] }
    expect(diffSellerChanges(legacy, { packageSize: "small" })).toEqual({})
    const other = { ...legacy, variants: [{ ...legacy.variants[0], weight: 5 }] }
    expect(diffSellerChanges(other, { packageSize: "small" })).toEqual({ packageSize: "small" })
  })
  it("compares bulky dimensions against the first variant", () => {
    const bulky = { ...live, metadata: { package_size: "bulky" }, variants: [{ ...live.variants![0], length: 40, width: 30, height: 20, weight: 2 }] }
    const same = { packageSize: "bulky" as const, packageDimensions: { length: 40, width: 30, height: 20, weight: 2 } }
    expect(diffSellerChanges(bulky, same)).toEqual({})
    expect(diffSellerChanges(bulky, { ...same, packageDimensions: { ...same.packageDimensions, weight: 3 } }))
      .toEqual({ packageSize: "bulky", packageDimensions: { length: 40, width: 30, height: 20, weight: 3 } })
  })
})

describe("pendingChangesOf", () => {
  it("returns null without pending_changes", () => expect(pendingChangesOf({ metadata: {} })).toBeNull())
  it("returns the stored object", () => {
    const pending = { title: "Novo", submittedAt: "2026-10-22T10:00:00Z" }
    expect(pendingChangesOf({ metadata: { pending_changes: pending } })).toEqual(pending)
  })
})
