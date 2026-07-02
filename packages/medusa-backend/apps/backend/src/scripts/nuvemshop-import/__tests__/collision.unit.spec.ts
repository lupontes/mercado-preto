import { isDuplicateHandleOrSkuError, slugifyTitle } from "../collision"

describe("isDuplicateHandleOrSkuError", () => {
  it("returns true for the exact duplicate-handle message observed in production logs", () => {
    const message = "Product with handle: sacola-de-palha-para-adulto, already exists."
    expect(isDuplicateHandleOrSkuError(message)).toBe(true)
  })

  it("returns true for the exact duplicate-sku message observed in production logs", () => {
    const message = "Product variant with sku: 9259, already exists."
    expect(isDuplicateHandleOrSkuError(message)).toBe(true)
  })

  it("returns false for undefined", () => {
    expect(isDuplicateHandleOrSkuError(undefined)).toBe(false)
  })

  it("returns false for an unrelated error message", () => {
    const message = "connect ETIMEDOUT 10.0.0.1:443"
    expect(isDuplicateHandleOrSkuError(message)).toBe(false)
  })
})

describe("slugifyTitle", () => {
  it("produces a lowercase, hyphenated slug for a typical title", () => {
    expect(slugifyTitle("Colar Africano Redondo")).toBe("colar-africano-redondo")
  })

  it("handles leading/trailing whitespace and repeated non-alphanumeric characters without leading/trailing hyphens", () => {
    expect(slugifyTitle("  Bolsa -- Artesanal!!  ")).toBe("bolsa-artesanal")
  })
})
