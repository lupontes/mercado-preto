import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GET } from "../route"

const product = (n: number, status = "published") => ({ id: `prod_${n}`, title: `P${n}`, handle: `p${n}`, thumbnail: null, status, description: "" })

function makeReq(status: string, products: unknown[], query: Record<string, string> = {}) {
  const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", status }])
  const graph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", products }] })
  const services: Record<string, unknown> = { seller: { listSellers }, [ContainerRegistrationKeys.QUERY]: { graph } }
  return { params: { id: "seller_1" }, query, scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /store/sellers/:id/products", () => {
  it.each(["pending", "approved", "suspended"])("hides the products of a %s store", async (status) => {
    const res = makeRes()
    await GET(makeReq(status, [product(1)]), res)
    expect(res._status).toBe(404)
  })

  it("lists only published products and counts them", async () => {
    const res = makeRes()
    await GET(makeReq("active", [product(1), product(2, "draft"), product(3)]), res)

    expect((res._body as any).products.map((p: any) => p.id)).toEqual(["prod_1", "prod_3"])
    expect((res._body as any).count).toBe(2)
  })

  it("pages over published products", async () => {
    const res = makeRes()
    await GET(makeReq("active", [product(1, "draft"), product(2), product(3), product(4)], { limit: "2", offset: "1" }), res)

    expect((res._body as any).products.map((p: any) => p.id)).toEqual(["prod_3", "prod_4"])
    expect((res._body as any).count).toBe(3)
  })
})
