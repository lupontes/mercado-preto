import { toPublicSeller } from "../public-seller"

describe("toPublicSeller", () => {
  it("keeps only the public seller shape and drops private columns", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z")
    const result = toPublicSeller({
      id: "seller_1",
      name: "Cestaria da Ana",
      bio: "Cestas",
      location: "Brasília",
      category: "artesanato",
      status: "active",
      created_at: createdAt,
      passwordHash: "hash",
      cpfCnpj: "123",
      email: "ana@example.com",
      pixKey: "ana@example.com",
    } as any)

    expect(result).toEqual({
      id: "seller_1",
      name: "Cestaria da Ana",
      bio: "Cestas",
      location: "Brasília",
      category: "artesanato",
      status: "active",
      created_at: createdAt,
    })
  })

  it("normalizes missing optional fields to null", () => {
    const result = toPublicSeller({ id: "s", name: "n", status: "active" })
    expect(result.bio).toBeNull()
    expect(result.location).toBeNull()
    expect(result.category).toBeNull()
  })
})
