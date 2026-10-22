jest.mock("@medusajs/medusa/core-flows", () => ({
  createProductsWorkflow: jest.fn(),
}))

jest.mock("../../../../utils/product-moderation-notify", () => ({
  notifyTeamProductSubmitted: jest.fn(),
}))

import { GET, POST } from "../route"
import { notifyTeamProductSubmitted } from "../../../../utils/product-moderation-notify"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

function mockCreateProductsWorkflow(result: unknown[]) {
  const run = jest.fn().mockResolvedValue({ result })
  ;(createProductsWorkflow as unknown as jest.Mock).mockReturnValue({ run })
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

  it("requests variant prices so the seller panel can show and edit the product price", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", products: [] }] })
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(graph).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.arrayContaining([
        "products.variants.id",
        "products.variants.prices.amount",
        "products.variants.prices.currency_code",
      ]),
    }))
  })
})

describe("GET /seller/products metadata", () => {
  it("requests products.metadata so the portal can show pending changes", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", products: [] }] })
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    } as any

    await GET(req, makeRes())

    expect(graph).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.arrayContaining(["products.metadata"]),
    }))
  })
})

describe("POST /seller/products", () => {
  const validBody = {
    title: "Produto teste",
    variants: [{ title: "Default", prices: [{ amount: 1000, currency_code: "brl" }] }],
  }

  beforeEach(() => {
    ;(createProductsWorkflow as unknown as jest.Mock).mockReset()
    ;(notifyTeamProductSubmitted as jest.Mock).mockReset().mockResolvedValue(undefined)
  })

  function makeModerationReq(body: Record<string, unknown>) {
    const graph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", name: "Loja Teste" }] })
    return {
      graph,
      req: {
        sellerId: "seller_1",
        body,
        scope: makeScope({
          [Modules.PRODUCT]: { listProductCategories: jest.fn() },
          [ContainerRegistrationKeys.LINK]: { create: jest.fn().mockResolvedValue(undefined) },
          [ContainerRegistrationKeys.QUERY]: { graph },
        }),
      } as any,
    }
  }

  it("rejects status published with 400", async () => {
    const run = mockCreateProductsWorkflow([{ id: "prod_1" }])
    const { req } = makeModerationReq({ ...validBody, status: "published" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it("creates a proposed product with submitted_at and alerts managers as new", async () => {
    const run = mockCreateProductsWorkflow([{ id: "prod_1", title: "Produto teste", handle: "produto-teste" }])
    const { req } = makeModerationReq({ ...validBody, status: "proposed", packageSize: "small" })
    const res = makeRes()

    await POST(req, res)

    const sent = run.mock.calls[0][0].input.products[0]
    expect(sent.status).toBe("proposed")
    expect(sent.metadata).toEqual(expect.objectContaining({
      package_size: "small",
      submitted_at: expect.any(String),
    }))
    expect(notifyTeamProductSubmitted).toHaveBeenCalledWith(
      { id: "prod_1", title: "Produto teste", handle: "produto-teste" },
      "Loja Teste",
      "new"
    )
    expect(res._status).toBe(201)
  })

  it("defaults to draft without alerting managers", async () => {
    const run = mockCreateProductsWorkflow([{ id: "prod_1" }])
    const { req } = makeModerationReq(validBody)
    const res = makeRes()

    await POST(req, res)

    const sent = run.mock.calls[0][0].input.products[0]
    expect(sent.status).toBe("draft")
    expect(sent.metadata.submitted_at).toBeUndefined()
    expect(notifyTeamProductSubmitted).not.toHaveBeenCalled()
  })

  it("still returns 201 when the manager alert fails", async () => {
    mockCreateProductsWorkflow([{ id: "prod_1", title: "P", handle: "p" }])
    ;(notifyTeamProductSubmitted as jest.Mock).mockRejectedValue(new Error("smtp down"))
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const { req } = makeModerationReq({ ...validBody, status: "proposed" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(201)
    errSpy.mockRestore()
  })

  it("passes category_ids to the create workflow when category_id is valid", async () => {
    const run = mockCreateProductsWorkflow([{ id: "prod_1" }])
    const listProductCategories = jest.fn().mockResolvedValue([{ id: "pcat_1" }])
    const linkCreate = jest.fn().mockResolvedValue(undefined)
    const req = {
      sellerId: "seller_1",
      body: { ...validBody, category_id: "pcat_1" },
      scope: makeScope({
        [Modules.PRODUCT]: { listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: linkCreate },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(listProductCategories).toHaveBeenCalledWith({ id: ["pcat_1"] })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input: { products: [expect.objectContaining({ category_ids: ["pcat_1"] })] },
    }))
    expect(res._status).toBe(201)
  })

  it("forwards variant prices to the create workflow", async () => {
    const run = mockCreateProductsWorkflow([{ id: "prod_1" }])
    const req = {
      sellerId: "seller_1",
      body: validBody,
      scope: makeScope({
        [Modules.PRODUCT]: { listProductCategories: jest.fn() },
        [ContainerRegistrationKeys.LINK]: { create: jest.fn().mockResolvedValue(undefined) },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        products: [expect.objectContaining({
          variants: [expect.objectContaining({
            title: "Default",
            prices: [{ amount: 1000, currency_code: "brl" }],
          })],
        })],
      },
    }))
  })

  it("omits category_ids when category_id is not provided", async () => {
    const run = mockCreateProductsWorkflow([{ id: "prod_1" }])
    const listProductCategories = jest.fn()
    const linkCreate = jest.fn().mockResolvedValue(undefined)
    const req = {
      sellerId: "seller_1",
      body: validBody,
      scope: makeScope({
        [Modules.PRODUCT]: { listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: linkCreate },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(listProductCategories).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input: { products: [expect.objectContaining({ category_ids: undefined })] },
    }))
    expect(res._status).toBe(201)
  })

  it("returns 400 and does not run the create workflow when category_id does not exist", async () => {
    const run = mockCreateProductsWorkflow([{ id: "prod_1" }])
    const listProductCategories = jest.fn().mockResolvedValue([])
    const req = {
      sellerId: "seller_1",
      body: { ...validBody, category_id: "pcat_missing" },
      scope: makeScope({
        [Modules.PRODUCT]: { listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: jest.fn() },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Categoria não encontrada" })
    expect(run).not.toHaveBeenCalled()
  })
})
