import { resolveNcmForVariant, GENERIC_CATEGORY_NAMES, buildFiscalItems } from "../ncm-resolver"

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

describe("buildFiscalItems", () => {
  function makeVariantQuery(ncmByVariant: Record<string, string | undefined>) {
    return {
      graph: jest.fn().mockImplementation(async ({ filters }: any) => {
        const ncm = ncmByVariant[filters.id]
        return {
          data: [{ product: { categories: ncm ? [{ name: "BOLSAS", metadata: { ncm } }] : [] } }],
        }
      }),
    }
  }

  it("resolves a single item's NCM and reports ncmFallbackUsed: false", async () => {
    const query = makeVariantQuery({ "variant-1": "42029200" })
    const { items, ncmFallbackUsed } = await buildFiscalItems(query as any, [
      { title: "Bolsa", quantity: 1, unit_price: 15000, variant_id: "variant-1" },
    ])

    expect(items).toEqual([
      { description: "Bolsa", quantity: 1, unitPrice: 15000, ncm: "42029200" },
    ])
    expect(ncmFallbackUsed).toBe(false)
  })

  it("reports ncmFallbackUsed: true when an item's variant fails to resolve an NCM", async () => {
    const query = makeVariantQuery({ "variant-1": undefined })
    const { items, ncmFallbackUsed } = await buildFiscalItems(query as any, [
      { title: "Item sem NCM", quantity: 1, unit_price: 1000, variant_id: "variant-1" },
    ])

    expect(items).toEqual([
      { description: "Item sem NCM", quantity: 1, unitPrice: 1000, ncm: undefined },
    ])
    expect(ncmFallbackUsed).toBe(true)
  })

  it("counts an item with no variant_id as a fallback without calling the resolver for it", async () => {
    const query = makeVariantQuery({})
    const { items, ncmFallbackUsed } = await buildFiscalItems(query as any, [
      { title: "Item avulso", quantity: 1, unit_price: 500 },
    ])

    expect(query.graph).not.toHaveBeenCalled()
    expect(items).toEqual([
      { description: "Item avulso", quantity: 1, unitPrice: 500, ncm: undefined },
    ])
    expect(ncmFallbackUsed).toBe(true)
  })

  it("reports ncmFallbackUsed: true overall when only one of several items fails to resolve", async () => {
    const query = makeVariantQuery({ "variant-1": "42029200", "variant-2": undefined })
    const { items, ncmFallbackUsed } = await buildFiscalItems(query as any, [
      { title: "Bolsa", quantity: 1, unit_price: 15000, variant_id: "variant-1" },
      { title: "Item sem categoria mapeada", quantity: 2, unit_price: 2000, variant_id: "variant-2" },
    ])

    expect(items).toEqual([
      { description: "Bolsa", quantity: 1, unitPrice: 15000, ncm: "42029200" },
      { description: "Item sem categoria mapeada", quantity: 2, unitPrice: 2000, ncm: undefined },
    ])
    expect(ncmFallbackUsed).toBe(true)
  })
})
