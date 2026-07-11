import { describe, expect, it } from "vitest"
import { formatCategoryName } from "../format"

describe("formatCategoryName", () => {
  it("converts ALL CAPS Nuvemshop names to title case", () => {
    expect(formatCategoryName("BOLSAS")).toBe("Bolsas")
    expect(formatCategoryName("COLARES")).toBe("Colares")
  })

  it("keeps Portuguese connectives in lowercase", () => {
    expect(formatCategoryName("KITS PARA COZINHA")).toBe("Kits para Cozinha")
    expect(formatCategoryName("CANECAS, COPOS E GARRAFAS")).toBe(
      "Canecas, Copos e Garrafas"
    )
  })

  it("capitalizes a connective when it is the first word", () => {
    expect(formatCategoryName("DE VOLTA")).toBe("De Volta")
  })

  it("preserves accented characters", () => {
    expect(formatCategoryName("LUMINÁRIAS")).toBe("Luminárias")
    expect(formatCategoryName("CHAPÉUS")).toBe("Chapéus")
  })

  it("leaves mixed-case names untouched (acronyms and curated names survive)", () => {
    expect(formatCategoryName("Roupas Afro")).toBe("Roupas Afro")
    expect(formatCategoryName("Produtos MAB")).toBe("Produtos MAB")
  })

  it("handles empty input", () => {
    expect(formatCategoryName("")).toBe("")
  })
})
