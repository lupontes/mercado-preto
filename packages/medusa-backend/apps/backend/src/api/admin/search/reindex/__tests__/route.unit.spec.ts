jest.mock("../../../../../utils/meilisearch", () => ({
  ensureIndexes: jest.fn(),
  getMeiliClient: jest.fn(),
  indexProduct: jest.fn(),
  indexSeller: jest.fn(),
  PRODUCTS_INDEX: "products",
  SELLERS_INDEX: "sellers",
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST } from "../route"
import { getMeiliClient, indexProduct, indexSeller } from "../../../../../utils/meilisearch"

function makeReq() {
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph: jest.fn().mockResolvedValue({ data: [{ id: "p1", status: "published", seller: { id: "s1" } }] }) },
    seller: { listSellers: jest.fn().mockResolvedValue([{ id: "s1", name: "Loja", status: "active", email: "a@b.com", passwordHash: "h" }]) },
  }
  return { scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /admin/search/reindex", () => {
  beforeEach(() => jest.clearAllMocks())

  it("answers 503 without Meilisearch", async () => {
    ;(getMeiliClient as jest.Mock).mockResolvedValue(null)
    const res = makeRes()
    await POST(makeReq(), res)
    expect(res._status).toBe(503)
  })

  it("reindexes published products and active sellers with public fields only", async () => {
    ;(getMeiliClient as jest.Mock).mockResolvedValue({})
    const res = makeRes()
    await POST(makeReq(), res)

    expect(res._body).toEqual({ message: "Reindexação concluída", indexed: { products: 1, sellers: 1 } })
    expect(indexProduct).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", sellerId: "s1" }))
    expect(JSON.stringify((indexSeller as jest.Mock).mock.calls[0][0])).not.toMatch(/a@b\.com|passwordHash/)
  })
})
