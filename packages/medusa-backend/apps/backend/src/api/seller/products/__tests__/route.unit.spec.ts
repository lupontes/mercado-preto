import { GET, POST } from "../route"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /seller/products", () => {
  it("requests categories id and name for each product", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", products: [] }] })
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(graph).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.arrayContaining(["products.categories.id", "products.categories.name"]),
    }))
  })
})

describe("POST /seller/products", () => {
  const validBody = {
    title: "Produto teste",
    variants: [{ title: "Default", prices: [{ amount: 1000, currency_code: "brl" }] }],
  }

  it("passes category_ids to createProducts when category_id is valid", async () => {
    const createProducts = jest.fn().mockResolvedValue([{ id: "prod_1" }])
    const listProductCategories = jest.fn().mockResolvedValue([{ id: "pcat_1" }])
    const linkCreate = jest.fn().mockResolvedValue(undefined)
    const req = {
      sellerId: "seller_1",
      body: { ...validBody, category_id: "pcat_1" },
      scope: makeScope({
        [Modules.PRODUCT]: { createProducts, listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: linkCreate },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(listProductCategories).toHaveBeenCalledWith({ id: ["pcat_1"] })
    expect(createProducts).toHaveBeenCalledWith([expect.objectContaining({ category_ids: ["pcat_1"] })])
    expect(res._status).toBe(201)
  })

  it("omits category_ids when category_id is not provided", async () => {
    const createProducts = jest.fn().mockResolvedValue([{ id: "prod_1" }])
    const listProductCategories = jest.fn()
    const linkCreate = jest.fn().mockResolvedValue(undefined)
    const req = {
      sellerId: "seller_1",
      body: validBody,
      scope: makeScope({
        [Modules.PRODUCT]: { createProducts, listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: linkCreate },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(listProductCategories).not.toHaveBeenCalled()
    expect(createProducts).toHaveBeenCalledWith([expect.objectContaining({ category_ids: undefined })])
    expect(res._status).toBe(201)
  })

  it("returns 400 and does not create the product when category_id does not exist", async () => {
    const createProducts = jest.fn()
    const listProductCategories = jest.fn().mockResolvedValue([])
    const req = {
      sellerId: "seller_1",
      body: { ...validBody, category_id: "pcat_missing" },
      scope: makeScope({
        [Modules.PRODUCT]: { createProducts, listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: jest.fn() },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Categoria não encontrada" })
    expect(createProducts).not.toHaveBeenCalled()
  })
})
