const run = jest.fn()
jest.mock("@medusajs/medusa/core-flows", () => ({ createProductsWorkflow: () => ({ run }) }))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeReq(body: unknown) {
  const link = { create: jest.fn() }
  return {
    body,
    sellerId: "s1",
    scope: { resolve: (k: string) => (k === Modules.PRODUCT ? {} : k === ContainerRegistrationKeys.LINK ? link : undefined) },
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}
const base = { title: "Colar de sementes", variants: [{ title: "Default", prices: [{ amount: 7700, currency_code: "brl" }] }] }

describe("POST /seller/products — package size", () => {
  beforeEach(() => run.mockReset().mockResolvedValue({ result: [{ id: "prod-1" }] }))

  it("writes the preset dimensions on every variant and the size in metadata", async () => {
    const res = makeRes()
    await POST(makeReq({ ...base, packageSize: "small" }), res)
    expect(res._status).toBe(201)
    const product = run.mock.calls[0][0].input.products[0]
    expect(product.variants[0]).toEqual(expect.objectContaining({ weight: 0.3, length: 16, width: 11, height: 6 }))
    expect(product.metadata).toEqual({ package_size: "small" })
  })

  it("stores bulky custom dimensions and flags them for team review", async () => {
    const res = makeRes()
    const dims = { weight: 1.2, length: 65, width: 40, height: 50 }
    await POST(makeReq({ ...base, packageSize: "bulky", packageDimensions: dims }), res)
    const product = run.mock.calls[0][0].input.products[0]
    expect(product.variants[0]).toEqual(expect.objectContaining(dims))
    expect(product.metadata).toEqual({ package_size: "bulky", package_review: "pending" })
  })

  it("rejects bulky without dimensions and dimensions above the Correios limits", async () => {
    let res = makeRes()
    await POST(makeReq({ ...base, packageSize: "bulky" }), res)
    expect(res._status).toBe(400)
    res = makeRes()
    await POST(makeReq({ ...base, packageSize: "bulky", packageDimensions: { weight: 1.8, length: 35, width: 120, height: 115 } }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toMatch(/limite dos Correios/)
    expect(run).not.toHaveBeenCalled()
  })

  it("defaults to medium when no size is sent", async () => {
    const res = makeRes()
    await POST(makeReq(base), res)
    const product = run.mock.calls[0][0].input.products[0]
    expect(product.variants[0]).toEqual(expect.objectContaining({ weight: 1, length: 25, width: 20, height: 10 }))
    expect(product.metadata).toEqual({ package_size: "medium" })
  })
})
