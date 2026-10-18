jest.mock("../../../../utils/meilisearch", () => {
  const actual = jest.requireActual("../../../../utils/meilisearch")
  return { ...actual, getMeiliClient: jest.fn() }
})

import { GET } from "../route"
import { getMeiliClient } from "../../../../utils/meilisearch"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const meiliSearch = jest.fn()
let graph: jest.Mock
let listSellers: jest.Mock
let logger: { error: jest.Mock }

function makeReq(query: Record<string, string>) {
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    seller: { listSellers },
    logger,
  }
  return { query, scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const product = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `prod_${n}`, title: `Produto ${n}`, handle: `produto-${n}`, thumbnail: null,
  status: "published", description: "", seller: { id: "seller_a" }, ...extra,
})

describe("GET /store/search", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    graph = jest.fn().mockResolvedValue({ data: [] })
    listSellers = jest.fn().mockResolvedValue([])
    logger = { error: jest.fn() }
  })

  describe("with Meilisearch", () => {
    beforeEach(() => {
      ;(getMeiliClient as jest.Mock).mockResolvedValue({ index: () => ({ search: meiliSearch }) })
      meiliSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 })
    })

    it("escapes filter values so they cannot change the expression", async () => {
      await GET(makeReq({ q: "", category: 'x" OR status = "draft' }), makeRes())

      expect(meiliSearch.mock.calls[0][1].filter).toBe('status = "published" AND category = "x\\" OR status = \\"draft"')
    })

    it("ignores a repeated query parameter instead of failing", async () => {
      const res = makeRes()
      await GET(makeReq({ q: "", category: ["a", "b"] } as any), res)

      expect(res._status).toBe(200)
      expect(meiliSearch.mock.calls[0][1].filter).toBe('status = "published"')
    })

    it("falls back to the database when Meilisearch fails", async () => {
      meiliSearch.mockRejectedValue(new Error("Attribute `status` is not filterable"))
      graph.mockResolvedValue({ data: [product(1)] })
      const res = makeRes()

      await GET(makeReq({ q: "produto" }), res)

      expect(res._status).toBe(200)
      expect((res._body as any).hits.map((h: any) => h.id)).toEqual(["prod_1"])
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error.mock.calls[0].length).toBeLessThanOrEqual(2)
    })
  })

  describe("database fallback", () => {
    beforeEach(() => {
      ;(getMeiliClient as jest.Mock).mockResolvedValue(null)
    })

    it("finds a match beyond the first page and counts after filtering", async () => {
      const products = Array.from({ length: 30 }, (_, i) => product(i + 1))
      products[24] = product(25, { title: "Turbante especial" })
      graph.mockResolvedValue({ data: products })
      const res = makeRes()

      await GET(makeReq({ q: "turbante" }), res)

      expect((res._body as any).hits.map((h: any) => h.id)).toEqual(["prod_25"])
      expect((res._body as any).total).toBe(1)
    })

    it("filters products by seller", async () => {
      graph.mockResolvedValue({ data: [product(1), product(2, { seller: { id: "seller_b" } })] })
      const res = makeRes()

      await GET(makeReq({ seller_id: "seller_b" }), res)

      expect((res._body as any).hits.map((h: any) => h.id)).toEqual(["prod_2"])
    })

    it("returns an empty page with the right total when the offset is past the end", async () => {
      graph.mockResolvedValue({ data: [product(1), product(2)] })
      const res = makeRes()

      await GET(makeReq({ offset: "40" }), res)

      expect((res._body as any).hits).toEqual([])
      expect((res._body as any).total).toBe(2)
    })

    it("filters sellers by category and location and returns only public fields", async () => {
      listSellers.mockResolvedValue([
        { id: "s1", name: "Loja A", category: "moda", location: "Salvador", status: "active", email: "a@x.com", passwordHash: "h" },
        { id: "s2", name: "Loja B", category: "moda", location: "Cachoeira", status: "active", email: "b@x.com" },
        { id: "s3", name: "Loja C", category: "arte", location: "Salvador", status: "active", email: "c@x.com" },
      ])
      const res = makeRes()

      await GET(makeReq({ type: "sellers", category: "moda", location: "Salvador" }), res)

      const body = res._body as any
      expect(body.hits.map((h: any) => h.id)).toEqual(["s1"])
      expect(JSON.stringify(body)).not.toContain("a@x.com")
      expect(JSON.stringify(body)).not.toContain("passwordHash")
    })
  })
})
