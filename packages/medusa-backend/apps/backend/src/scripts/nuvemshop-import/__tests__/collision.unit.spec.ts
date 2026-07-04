import {
  buildCollisionRetryInput,
  detectDuplicateCollision,
  slugifyTitle,
} from "../collision"

describe("detectDuplicateCollision", () => {
  it("returns 'handle' for the exact duplicate-handle message observed in production logs", () => {
    const message = "Product with handle: sacola-de-palha-para-adulto, already exists."
    expect(detectDuplicateCollision(message)).toBe("handle")
  })

  it("returns 'sku' for the exact duplicate-sku message observed in production logs", () => {
    const message = "Product variant with sku: 9259, already exists."
    expect(detectDuplicateCollision(message)).toBe("sku")
  })

  it("returns null for undefined", () => {
    expect(detectDuplicateCollision(undefined)).toBe(null)
  })

  it("returns null for an unrelated error message", () => {
    const message = "connect ETIMEDOUT 10.0.0.1:443"
    expect(detectDuplicateCollision(message)).toBe(null)
  })
})

describe("slugifyTitle", () => {
  it("produces a lowercase, hyphenated slug for a typical title", () => {
    expect(slugifyTitle("Colar Africano Redondo")).toBe("colar-africano-redondo")
  })

  it("handles leading/trailing whitespace and repeated non-alphanumeric characters without leading/trailing hyphens", () => {
    expect(slugifyTitle("  Bolsa -- Artesanal!!  ")).toBe("bolsa-artesanal")
  })

  it("transliterates accented Portuguese characters instead of dropping them", () => {
    expect(slugifyTitle("Luminária Grande")).toBe("luminaria-grande")
  })
})

describe("buildCollisionRetryInput", () => {
  const baseInput = {
    title: "Bolsa Africana 2 em 1",
    handle: "bolsa-africana-2-em-1",
    variants: [
      { sku: "8730", title: "Padrão" },
      { sku: "8731", title: "Outra" },
    ],
  } as any

  it("on a handle collision, rewrites only the handle and leaves every variant SKU untouched", () => {
    const result = buildCollisionRetryInput(baseInput, "handle", 201563123)

    expect(result.handle).toBe("bolsa-africana-2-em-1-201563123")
    expect(result.variants!.map((v: any) => v.sku)).toEqual(["8730", "8731"])
  })

  it("on a handle collision with no source handle, falls back to a slug of the title", () => {
    const inputWithoutHandle = { ...baseInput, handle: undefined }
    const result = buildCollisionRetryInput(inputWithoutHandle, "handle", 201563123)

    expect(result.handle).toBe("bolsa-africana-2-em-1-201563123")
  })

  it("on a sku collision, rewrites every variant SKU and leaves the handle untouched", () => {
    const result = buildCollisionRetryInput(baseInput, "sku", 201563123)

    expect(result.handle).toBe("bolsa-africana-2-em-1")
    expect(result.variants!.map((v: any) => v.sku)).toEqual([
      "8730-201563123",
      "8731-201563123",
    ])
  })

  it("on a sku collision, leaves variants without a SKU unchanged", () => {
    const inputWithBlankSku = {
      ...baseInput,
      variants: [{ sku: undefined, title: "Padrão" }],
    }
    const result = buildCollisionRetryInput(inputWithBlankSku, "sku", 1)

    expect(result.variants![0].sku).toBeUndefined()
  })
})
