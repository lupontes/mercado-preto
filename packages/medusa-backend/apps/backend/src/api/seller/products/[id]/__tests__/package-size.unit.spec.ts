const run = jest.fn()
jest.mock("@medusajs/medusa/core-flows", () => ({ updateProductsWorkflow: () => ({ run }) }))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PATCH } from "../route"

function makeReq(body: unknown) {
  const productService = { updateProductVariants: jest.fn() }
  const graph = jest.fn(async ({ entity }: any) =>
    entity === "seller"
      ? { data: [{ products: [{ id: "prod-1" }] }] }
      : { data: [{ id: "prod-1", metadata: { origin: "nuvemshop" } }] }
  )
  return {
    body, params: { id: "prod-1" }, sellerId: "s1",
    scope: { resolve: (k: string) => (k === Modules.PRODUCT ? productService : k === ContainerRegistrationKeys.QUERY ? { graph } : undefined) },
    _productService: productService,
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("PATCH /seller/products/:id — package size", () => {
  beforeEach(() => run.mockReset().mockResolvedValue({ result: [{ id: "prod-1" }] }))

  it("updates every variant's dimensions and merges metadata", async () => {
    const req = makeReq({ packageSize: "large" })
    const res = makeRes()
    await PATCH(req, res)
    expect(res._status).toBe(200)
    expect(req._productService.updateProductVariants).toHaveBeenCalledWith(
      { product_id: "prod-1" },
      { weight: 3, length: 40, width: 30, height: 20 }
    )
    expect(run.mock.calls[0][0].input.products[0].metadata).toEqual({ origin: "nuvemshop", package_size: "large" })
  })

  it("stores bulky edits with the size in metadata", async () => {
    const req = makeReq({ packageSize: "bulky", packageDimensions: { weight: 1, length: 50, width: 50, height: 50 } })
    await PATCH(req, makeRes())
    expect(run.mock.calls[0][0].input.products[0].metadata).toEqual({ origin: "nuvemshop", package_size: "bulky" })
  })

  it("does not touch dimensions when no package size is sent", async () => {
    const req = makeReq({ title: "Novo título" })
    await PATCH(req, makeRes())
    expect(req._productService.updateProductVariants).not.toHaveBeenCalled()
    expect(run.mock.calls[0][0].input.products[0].metadata).toBeUndefined()
  })
})
