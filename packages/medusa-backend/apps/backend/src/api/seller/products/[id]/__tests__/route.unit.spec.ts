jest.mock("@medusajs/medusa/core-flows", () => ({
  updateProductsWorkflow: jest.fn(),
}))

import { GET, PATCH } from "../route"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

function mockUpdateProductsWorkflow(result: unknown[]) {
  const run = jest.fn().mockResolvedValue({ result })
  ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue({ run })
  return run
}

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
  it("fetches categories and variant prices via the remote query", async () => {
    const graph = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: "seller_1", products: [{ id: "prod_1" }] }] })
      .mockResolvedValueOnce({ data: [{ id: "prod_1", categories: [], variants: [] }] })
    const req = {
      sellerId: "seller_1",
      params: { id: "prod_1" },
      scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(graph).toHaveBeenLastCalledWith(expect.objectContaining({
      entity: "product",
      fields: expect.arrayContaining([
        "categories.id",
        "categories.name",
        "variants.id",
        "variants.prices.amount",
        "variants.prices.currency_code",
      ]),
      filters: { id: "prod_1" },
    }))
    expect(res._status).toBe(200)
  })

  it("returns 404 without hitting the product graph when the seller doesn't own the product", async () => {
    const graph = jest.fn().mockResolvedValueOnce({ data: [{ id: "seller_1", products: [] }] })
    const req = {
      sellerId: "seller_1",
      params: { id: "prod_missing" },
      scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res._status).toBe(404)
    expect(graph).toHaveBeenCalledTimes(1)
  })
})

describe("PATCH /seller/products/:id", () => {
  beforeEach(() => {
    ;(updateProductsWorkflow as unknown as jest.Mock).mockReset()
  })

  function makeReq(body: unknown, serviceOverrides: Record<string, unknown> = {}) {
    return {
      sellerId: "seller_1",
      params: { id: "prod_1" },
      body,
      scope: makeScope({
        [ContainerRegistrationKeys.QUERY]: { graph: linkedGraph },
        [Modules.PRODUCT]: {
          listProductCategories: jest.fn().mockResolvedValue([{ id: "pcat_1" }]),
          ...serviceOverrides,
        },
      }),
    } as any
  }

  it("sets category_ids when category_id is a valid string", async () => {
    const run = mockUpdateProductsWorkflow([{ id: "prod_1" }])
    const req = makeReq({ category_id: "pcat_1" })
    const res = makeRes()

    await PATCH(req, res)

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input: { selector: { id: "prod_1" }, update: expect.objectContaining({ category_ids: ["pcat_1"] }) },
    }))
    expect(res._status).toBe(200)
  })

  it("clears category_ids when category_id is null", async () => {
    const run = mockUpdateProductsWorkflow([{ id: "prod_1" }])
    const req = makeReq({ category_id: null })
    const res = makeRes()

    await PATCH(req, res)

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input: { selector: { id: "prod_1" }, update: expect.objectContaining({ category_ids: [] }) },
    }))
  })

  it("does not touch category_ids when category_id is absent from the body", async () => {
    const run = mockUpdateProductsWorkflow([{ id: "prod_1" }])
    const req = makeReq({ title: "Novo título" })
    const res = makeRes()

    await PATCH(req, res)

    const { update } = run.mock.calls[0][0].input
    expect(update).not.toHaveProperty("category_ids")
  })

  it("forwards variant price updates to the update workflow", async () => {
    const run = mockUpdateProductsWorkflow([{ id: "prod_1" }])
    const req = makeReq({
      variants: [{ id: "variant_1", prices: [{ amount: 12990, currency_code: "brl" }] }],
    })
    const res = makeRes()

    await PATCH(req, res)

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        selector: { id: "prod_1" },
        update: expect.objectContaining({
          variants: [{ id: "variant_1", prices: [{ amount: 12990, currency_code: "brl" }] }],
        }),
      },
    }))
    expect(res._status).toBe(200)
  })

  it("returns 400 and does not run the update workflow when category_id does not exist", async () => {
    const run = mockUpdateProductsWorkflow([{ id: "prod_1" }])
    const listProductCategories = jest.fn().mockResolvedValue([])
    const req = makeReq({ category_id: "pcat_missing" }, { listProductCategories })
    const res = makeRes()

    await PATCH(req, res)

    expect(res._status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it("returns 400 and does not run the update workflow when category_id is an empty string", async () => {
    const run = mockUpdateProductsWorkflow([{ id: "prod_1" }])
    const req = makeReq({ category_id: "" })
    const res = makeRes()

    await PATCH(req, res)

    expect(res._status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})
