import { GET } from "../route"

const PRIVATE_SELLER_KEYS = [
  "passwordHash",
  "cpfCnpj",
  "email",
  "pixKey",
  "pixKeyType",
  "phone",
  "ownerName",
  "bankName",
  "bankAgency",
  "bankAccount",
  "bankAccountType",
  "mercadopagoUserId",
  "rejectionReason",
]

const PUBLIC_SELLER_KEYS = ["id", "name", "bio", "location", "category", "status", "created_at"]

// Every column the seller model has, so a leak of any private one is caught.
const SEEDED_SELLER = {
  id: "seller_1",
  name: "Cestaria da Ana",
  ownerName: "Ana Souza",
  email: "ana@example.com",
  phone: "+5561999990000",
  cpfCnpj: "123.456.789-00",
  bio: "Cestas artesanais de vime",
  location: "Brasília",
  category: "artesanato",
  bankName: "Banco X",
  bankAgency: "0001",
  bankAccount: "12345-6",
  bankAccountType: "checking",
  pixKey: "ana@example.com",
  pixKeyType: "email",
  status: "active",
  rejectionReason: null,
  mercadopagoUserId: "mp_123",
  passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
  created_at: new Date("2026-01-01T00:00:00Z"),
}

function buildReq(query: Record<string, string>, listSellers = jest.fn().mockResolvedValue([SEEDED_SELLER])) {
  return {
    query,
    scope: {
      resolve: (key: string) => {
        if (key === "seller") return { listSellers }
        if (key === "query") return { graph: jest.fn().mockResolvedValue({ data: [] }) }
        throw new Error(`unexpected resolve: ${key}`)
      },
    },
  } as any
}

function buildRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("GET /store/search fallback (no Meilisearch)", () => {
  const originalHost = process.env.MEILISEARCH_HOST

  beforeEach(() => {
    delete process.env.MEILISEARCH_HOST
  })

  afterAll(() => {
    if (originalHost === undefined) delete process.env.MEILISEARCH_HOST
    else process.env.MEILISEARCH_HOST = originalHost
  })

  it("returns only public seller fields for type=sellers", async () => {
    const res = buildRes()
    await GET(buildReq({ type: "sellers" }), res)

    const body = res.json.mock.calls[0][0]
    expect(body.total).toBe(1)
    const [hit] = body.hits
    expect(Object.keys(hit).sort()).toEqual([...PUBLIC_SELLER_KEYS].sort())
    for (const key of PRIVATE_SELLER_KEYS) {
      expect(hit).not.toHaveProperty(key)
    }
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(SEEDED_SELLER.passwordHash)
    expect(serialized).not.toContain(SEEDED_SELLER.cpfCnpj)
    expect(serialized).not.toContain(SEEDED_SELLER.email)
  })

  it("still filters sellers by the search term before projecting", async () => {
    const other = { ...SEEDED_SELLER, id: "seller_2", name: "Doces da Bia", bio: "Doces caseiros" }
    const listSellers = jest.fn().mockResolvedValue([SEEDED_SELLER, other])
    const res = buildRes()

    await GET(buildReq({ type: "sellers", q: "doces" }, listSellers), res)

    const body = res.json.mock.calls[0][0]
    expect(body.hits.map((h: any) => h.id)).toEqual(["seller_2"])
    expect(body.hits[0]).not.toHaveProperty("passwordHash")
    expect(listSellers).toHaveBeenCalledWith({ status: "active" }, { take: 20, skip: 0 })
  })
})
