import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GET } from "../route"

function makeReq(products: unknown[], sellers: unknown[]) {
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph: jest.fn().mockResolvedValue({ data: products }) },
    seller: { listSellers: jest.fn().mockResolvedValue(sellers) },
  }
  return { scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { headers: {} as Record<string, string>, body: "" } as any
  res.setHeader = (k: string, v: string) => { res.headers[k] = v }
  res.send = (b: string) => { res.body = b; return res }
  return res
}

const locs = (xml: string) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])

describe("GET /store/sitemap", () => {
  const original = process.env.STORE_CORS
  beforeEach(() => { process.env.STORE_CORS = "https://teste.mercadopreto.com.br,http://localhost:3000" })
  afterAll(() => { process.env.STORE_CORS = original })

  it("uses the storefront routes and only pages that exist", async () => {
    const res = makeRes()
    await GET(makeReq(
      [{ id: "p1", handle: "colar", seller: { status: "active" } }],
      [{ id: "s1", status: "active" }]
    ), res)

    expect(locs(res.body)).toEqual([
      "https://teste.mercadopreto.com.br",
      "https://teste.mercadopreto.com.br/lojas",
      "https://teste.mercadopreto.com.br/produtos",
      "https://teste.mercadopreto.com.br/categorias",
      "https://teste.mercadopreto.com.br/sobre",
      "https://teste.mercadopreto.com.br/produto/colar",
      "https://teste.mercadopreto.com.br/loja/s1",
    ])
    expect(res.headers["Content-Type"]).toBe("application/xml; charset=utf-8")
  })

  it("leaves out products of stores that are not active", async () => {
    const res = makeRes()
    await GET(makeReq(
      [{ id: "p1", handle: "ativo", seller: { status: "active" } }, { id: "p2", handle: "suspensa", seller: { status: "suspended" } }, { id: "p3", handle: "sem-loja" }],
      []
    ), res)

    expect(locs(res.body).filter((l) => l.includes("/produto/"))).toEqual(["https://teste.mercadopreto.com.br/produto/ativo"])
  })

  it("escapes XML characters in handles", async () => {
    const res = makeRes()
    await GET(makeReq([{ id: "p1", handle: "a&b", seller: { status: "active" } }], []), res)
    expect(res.body).toContain("/produto/a&amp;b")
  })
})
