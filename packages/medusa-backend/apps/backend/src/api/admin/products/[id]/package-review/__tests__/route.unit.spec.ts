import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeReq(body: unknown) {
  const productService = { updateProducts: jest.fn(async (id: string, data: any) => ({ id, ...data })) }
  const graph = jest.fn().mockResolvedValue({ data: [{ id: "prod-1", metadata: { package_size: "bulky", package_review: "pending", origin: "x" } }] })
  return {
    body, params: { id: "prod-1" },
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

describe("POST /admin/products/:id/package-review", () => {
  it("marks the measures as approved keeping the rest of the metadata", async () => {
    const req = makeReq({ status: "approved" })
    const res = makeRes()
    await POST(req, res)
    expect(req._productService.updateProducts).toHaveBeenCalledWith("prod-1", {
      metadata: { package_size: "bulky", package_review: "approved", origin: "x" },
    })
    expect(res._status).toBe(200)
  })

  it("rejects other statuses", async () => {
    const res = makeRes()
    await POST(makeReq({ status: "whatever" }), res)
    expect(res._status).toBe(400)
  })
})
