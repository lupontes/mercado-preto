import { GET } from "../route"

describe("GET /store/sellers", () => {
  it("lists sellers through the public projection only", async () => {
    const row = {
      id: "seller_1",
      name: "Cestaria da Ana",
      bio: "Cestas",
      location: "Brasília",
      category: "artesanato",
      status: "active",
      created_at: new Date("2026-01-01T00:00:00Z"),
      passwordHash: "hash",
      cpfCnpj: "123.456.789-00",
      email: "ana@example.com",
      pixKey: "ana@example.com",
    }
    const req = {
      query: {},
      scope: { resolve: () => ({ listSellers: jest.fn().mockResolvedValue([row]) }) },
    } as any
    const res: any = { json: jest.fn() }

    await GET(req, res)

    const [seller] = res.json.mock.calls[0][0].sellers
    expect(Object.keys(seller).sort()).toEqual(
      ["bio", "category", "created_at", "id", "location", "name", "status"]
    )
  })
})
