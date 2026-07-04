import { GET, PATCH } from "../route"
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

const linkedGraph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", products: [{ id: "prod_1" }] }] })

describe("GET /seller/products/:id", () => {
  it("requests the categories relation", async () => {
    const listProducts = jest.fn().mockResolvedValue([{ id: "prod_1", categories: [] }])
    const req = {
      sellerId: "seller_1",
      params: { id: "prod_1" },
      scope: makeScope({
        [ContainerRegistrationKeys.QUERY]: { graph: linkedGraph },
        [Modules.PRODUCT]: { listProducts },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listProducts).toHaveBeenCalledWith({ id: ["prod_1"] }, { relations: ["categories"] })
    expect(res._status).toBe(200)
  })
})

describe("PATCH /seller/products/:id", () => {
  function makeReq(body: unknown, serviceOverrides: Record<string, unknown> = {}) {
    return {
      sellerId: "seller_1",
      params: { id: "prod_1" },
      body,
      scope: makeScope({
        [ContainerRegistrationKeys.QUERY]: { graph: linkedGraph },
        [Modules.PRODUCT]: {
          updateProducts: jest.fn().mockResolvedValue({ id: "prod_1" }),
          listProductCategories: jest.fn().mockResolvedValue([{ id: "pcat_1" }]),
          ...serviceOverrides,
        },
      }),
    } as any
  }

  it("sets category_ids when category_id is a valid string", async () => {
    const updateProducts = jest.fn().mockResolvedValue({ id: "prod_1" })
    const req = makeReq({ category_id: "pcat_1" }, { updateProducts })
    const res = makeRes()

    await PATCH(req, res)

    expect(updateProducts).toHaveBeenCalledWith("prod_1", expect.objectContaining({ category_ids: ["pcat_1"] }))
    expect(res._status).toBe(200)
  })

  it("clears category_ids when category_id is null", async () => {
    const updateProducts = jest.fn().mockResolvedValue({ id: "prod_1" })
    const req = makeReq({ category_id: null }, { updateProducts })
    const res = makeRes()

    await PATCH(req, res)

    expect(updateProducts).toHaveBeenCalledWith("prod_1", expect.objectContaining({ category_ids: [] }))
  })

  it("does not touch category_ids when category_id is absent from the body", async () => {
    const updateProducts = jest.fn().mockResolvedValue({ id: "prod_1" })
    const req = makeReq({ title: "Novo título" }, { updateProducts })
    const res = makeRes()

    await PATCH(req, res)

    const [, updateData] = updateProducts.mock.calls[0]
    expect(updateData).not.toHaveProperty("category_ids")
  })

  it("returns 400 and does not update when category_id does not exist", async () => {
    const updateProducts = jest.fn()
    const listProductCategories = jest.fn().mockResolvedValue([])
    const req = makeReq({ category_id: "pcat_missing" }, { updateProducts, listProductCategories })
    const res = makeRes()

    await PATCH(req, res)

    expect(res._status).toBe(400)
    expect(updateProducts).not.toHaveBeenCalled()
  })
})
