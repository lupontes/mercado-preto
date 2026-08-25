import { resolveNcmForVariant, GENERIC_CATEGORY_NAMES } from "../ncm-resolver"

function makeQuery(categories: Array<{ name: string; metadata?: Record<string, unknown> }>) {
  return {
    graph: jest.fn().mockResolvedValue({
      data: [{ product: { categories } }],
    }),
  }
}

describe("resolveNcmForVariant", () => {
  it("returns the NCM from the only category when it has a valid one", async () => {
    const query = makeQuery([{ name: "BOLSAS", metadata: { ncm: "42029200" } }])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("42029200")
  })

  it("prefers a specific category over a generic one, regardless of order", async () => {
    const query = makeQuery([
      { name: "Produtos MAB", metadata: { ncm: "99999999" } },
      { name: "BOLSAS", metadata: { ncm: "42029200" } },
    ])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("42029200")
  })

  it("picks the alphabetically-first specific category when more than one has a valid NCM", async () => {
    const query = makeQuery([
      { name: "COLARES", metadata: { ncm: "71179000" } },
      { name: "BOLSAS", metadata: { ncm: "42029200" } },
    ])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("42029200")
  })

  it("skips a specific category with no metadata.ncm and uses the next one", async () => {
    const query = makeQuery([
      { name: "BOLSAS", metadata: {} },
      { name: "COLARES", metadata: { ncm: "71179000" } },
    ])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBe("71179000")
  })

  it("treats a malformed NCM (not 8 digits) as absent", async () => {
    const query = makeQuery([{ name: "BOLSAS", metadata: { ncm: "4202.92.00" } }])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("returns undefined when only the generic category is present", async () => {
    const query = makeQuery([{ name: "Produtos MAB", metadata: { ncm: "99999999" } }])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("returns undefined when the product has no categories", async () => {
    const query = makeQuery([])
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("returns undefined instead of throwing when the query fails", async () => {
    const query = { graph: jest.fn().mockRejectedValue(new Error("db unavailable")) }
    await expect(resolveNcmForVariant(query as any, "variant-1")).resolves.toBeUndefined()
  })

  it("queries product_variant filtered by the given id, requesting category name and metadata", async () => {
    const query = makeQuery([{ name: "BOLSAS", metadata: { ncm: "42029200" } }])
    await resolveNcmForVariant(query as any, "variant-42")
    expect(query.graph).toHaveBeenCalledWith({
      entity: "product_variant",
      fields: ["product.categories.name", "product.categories.metadata"],
      filters: { id: "variant-42" },
    })
  })

  it("exposes GENERIC_CATEGORY_NAMES containing 'Produtos MAB'", () => {
    expect(GENERIC_CATEGORY_NAMES).toContain("Produtos MAB")
  })
})
