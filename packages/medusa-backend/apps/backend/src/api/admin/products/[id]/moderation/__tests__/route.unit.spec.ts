jest.mock("@medusajs/medusa/core-flows", () => ({ updateProductsWorkflow: jest.fn() }))
jest.mock("../../../../../seller/products/apply-update", () => ({ applySellerProductUpdate: jest.fn() }))
jest.mock("../../../../../../utils/product-moderation-notify", () => ({ notifySellerProductApproved: jest.fn() }))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { applySellerProductUpdate } from "../../../../../seller/products/apply-update"
import { notifySellerProductApproved } from "../../../../../../utils/product-moderation-notify"
import { GET, POST } from "../route"

const seller = { name: "Loja", phone: "5511", email: "l@x.com" }

function makeReq(product: any, body?: unknown) {
  const graph = jest.fn().mockResolvedValue({ data: product ? [product] : [] })
  const scope = { resolve: (k: string) => (k === ContainerRegistrationKeys.QUERY ? { graph } : undefined) }
  return { req: { scope, params: { id: "prod_1" }, body } as any, graph }
}

// The version a manager would have seen: what GET returned for the same product.
async function versionOf(p: any): Promise<string> {
  const res = makeRes()
  await GET(makeReq(p).req, res)
  return res._body.version
}

const STALE = "A vendedora alterou o produto. Recarregue e confira de novo."

function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

const run = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  run.mockResolvedValue({ result: [{ id: "prod_1" }] })
  ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue({ run })
  ;(applySellerProductUpdate as jest.Mock).mockResolvedValue({ ok: true, product: { id: "prod_1" } })
})

const product = (over: Record<string, unknown>) => ({ id: "prod_1", title: "T", handle: "t", status: "published", metadata: null, seller, ...over })

describe("GET /admin/products/:id/moderation", () => {
  it("returns kind change with the pending changes and seller", async () => {
    const pending = { title: "N", submittedAt: "s" }
    const { req } = makeReq(product({ metadata: { pending_changes: pending } }))
    const res = makeRes()
    await GET(req, res)
    expect(res._body).toMatchObject({ kind: "change", pendingChanges: pending, seller: { name: "Loja", phone: "5511" } })
  })

  it("returns kind new for a proposed product", async () => {
    const { req } = makeReq(product({ status: "proposed" }))
    const res = makeRes()
    await GET(req, res)
    expect(res._body).toMatchObject({ kind: "new", pendingChanges: null, seller: { name: "Loja", phone: "5511" } })
  })

  it("returns kind null when nothing awaits review and 404 for unknown product", async () => {
    const res = makeRes()
    await GET(makeReq(product({})).req, res)
    expect(res._body.kind).toBeNull()
    const res404 = makeRes()
    await GET(makeReq(null).req, res404)
    expect(res404._status).toBe(404)
  })
})

describe("GET current values", () => {
  it("returns the live values the widget compares against", async () => {
    const { req } = makeReq(product({
      description: "D", thumbnail: "t.png", metadata: { package_size: "small" },
      categories: [{ id: "pcat_1" }],
      variants: [{ weight: 1, length: 2, width: 3, height: 4, prices: [{ amount: 5000, currency_code: "usd" }, { amount: 4000, currency_code: "brl" }] }],
    }))
    const res = makeRes()
    await GET(req, res)
    expect(res._body.current).toEqual({
      title: "T", description: "D", thumbnail: "t.png", categoryId: "pcat_1", price: 4000,
      packageSize: "small", packageDimensions: { weight: 1, length: 2, width: 3, height: 4 },
    })
  })

  it("returns nulls for a product without variants or category", async () => {
    const res = makeRes()
    await GET(makeReq(product({})).req, res)
    expect(res._body.current).toMatchObject({ categoryId: null, price: null, packageSize: null, packageDimensions: null })
  })
})

describe("POST /admin/products/:id/moderation", () => {
  it("publishes a proposed product without notifying (the subscriber does)", async () => {
    const p = product({ status: "proposed" })
    const { req } = makeReq(p, { version: await versionOf(p) })
    const res = makeRes()
    await POST(req, res)
    expect(run.mock.calls[0][0].input.products).toEqual([{ id: "prod_1", status: "published" }])
    expect(notifySellerProductApproved).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })

  it("applies pending changes without submittedAt, clears the pendency and notifies", async () => {
    const { req } = makeReq(product({ metadata: { pending_changes: { title: "N", submittedAt: "s" } } }), { version: "s" })
    const res = makeRes()
    await POST(req, res)
    expect(applySellerProductUpdate).toHaveBeenCalledWith(req.scope, "prod_1", { title: "N" }, { pending_changes: null })
    expect(notifySellerProductApproved).toHaveBeenCalledWith(seller, { id: "prod_1", title: "T", handle: "t" }, "change")
    expect(res._status).toBe(200)
  })

  it("does not add a category_id key when the pendency has none", async () => {
    const { req } = makeReq(product({ metadata: { pending_changes: { title: "N", submittedAt: "s" } } }), { version: "s" })
    await POST(req, makeRes())
    expect((applySellerProductUpdate as jest.Mock).mock.calls[0][2]).not.toHaveProperty("category_id")
  })

  it("keeps the 200 when the notice fails", async () => {
    ;(notifySellerProductApproved as jest.Mock).mockRejectedValue(new Error("boom"))
    jest.spyOn(console, "error").mockImplementation(() => {})
    const { req } = makeReq(product({ metadata: { pending_changes: { title: "N", submittedAt: "s" } } }), { version: "s" })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(200)
  })

  it("answers 409 with the message when the application fails, and does not notify", async () => {
    ;(applySellerProductUpdate as jest.Mock).mockResolvedValue({ ok: false, status: 400, error: "Categoria não encontrada" })
    const { req } = makeReq(product({ metadata: { pending_changes: { category_id: "gone", submittedAt: "s" } } }), { version: "s" })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(409)
    expect(res._body).toEqual({ error: "Categoria não encontrada", message: "Categoria não encontrada" })
    expect(notifySellerProductApproved).not.toHaveBeenCalled()
  })

  it("answers 409 Nada para aprovar when nothing is pending", async () => {
    const res = makeRes()
    await POST(makeReq(product({}), { version: "x" }).req, res)
    expect(res._status).toBe(409)
    expect(res._body).toEqual({ error: "Nada para aprovar", message: "Nada para aprovar" })
  })

  it("passes only the listed variant (with id) when a two-variant product has a partial list", async () => {
    const pending = { variants: [{ id: "v1", prices: [{ amount: 10, currency_code: "brl" }] }], submittedAt: "s" }
    const { req } = makeReq(product({ metadata: { pending_changes: pending } }), { version: "s" })
    await POST(req, makeRes())
    const changes = (applySellerProductUpdate as jest.Mock).mock.calls[0][2]
    expect(changes.variants).toEqual([{ id: "v1", prices: [{ amount: 10, currency_code: "brl" }] }])
  })

  describe("stale review", () => {
    it("answers 409 and keeps the pendency when the seller saved a newer pending edit", async () => {
      const { req } = makeReq(product({ metadata: { pending_changes: { title: "Newer", submittedAt: "s2" } } }), { version: "s1" })
      const res = makeRes()
      await POST(req, res)
      expect(res._status).toBe(409)
      expect(res._body).toEqual({ error: STALE, message: STALE })
      expect(applySellerProductUpdate).not.toHaveBeenCalled()
      expect(notifySellerProductApproved).not.toHaveBeenCalled()
    })

    it("answers 409 without publishing when a product in review changed after it was shown", async () => {
      const seen = await versionOf(product({ status: "proposed", title: "Old" }))
      const { req } = makeReq(product({ status: "proposed", title: "New" }), { version: seen })
      const res = makeRes()
      await POST(req, res)
      expect(res._status).toBe(409)
      expect(res._body).toEqual({ error: STALE, message: STALE })
      expect(run).not.toHaveBeenCalled()
    })

    it("also catches a price-only edit to a product in review", async () => {
      const withPrice = (amount: number) =>
        product({ status: "proposed", variants: [{ prices: [{ amount, currency_code: "brl" }] }] })
      const seen = await versionOf(withPrice(1000))
      const res = makeRes()
      await POST(makeReq(withPrice(2000), { version: seen }).req, res)
      expect(res._status).toBe(409)
    })

    it.each([undefined, {}, { version: 1 }])("answers 409 when the body carries no version (%p)", async (body) => {
      const res = makeRes()
      await POST(makeReq(product({ metadata: { pending_changes: { title: "N", submittedAt: "s" } } }), body).req, res)
      expect(res._status).toBe(409)
      expect(applySellerProductUpdate).not.toHaveBeenCalled()
    })
  })
})

describe("GET version", () => {
  it("is the pendency submittedAt for a change", async () => {
    expect(await versionOf(product({ metadata: { pending_changes: { title: "N", submittedAt: "s" } } }))).toBe("s")
  })

  it("is a stable fingerprint of the shown values for a new product", async () => {
    const a = await versionOf(product({ status: "proposed" }))
    expect(typeof a).toBe("string")
    expect(await versionOf(product({ status: "proposed" }))).toBe(a)
    expect(await versionOf(product({ status: "proposed", description: "other" }))).not.toBe(a)
  })

  it("is null when nothing awaits review", async () => {
    expect(await versionOf(product({}))).toBeNull()
  })
})
