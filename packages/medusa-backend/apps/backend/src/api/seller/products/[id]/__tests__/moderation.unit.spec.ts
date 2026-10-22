const run = jest.fn()
jest.mock("@medusajs/medusa/core-flows", () => ({ updateProductsWorkflow: () => ({ run }) }))
jest.mock("../../../../../utils/product-moderation-notify", () => ({
  notifyTeamProductSubmitted: jest.fn(),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { GET, PATCH } from "../route"
import { notifyTeamProductSubmitted } from "../../../../../utils/product-moderation-notify"

const notify = notifyTeamProductSubmitted as jest.Mock

const PRICE = [{ amount: 5000, currency_code: "brl" }]

function liveProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    handle: "colar-de-buzios",
    status: "published",
    title: "Colar de búzios",
    description: "Feito à mão",
    thumbnail: "https://cdn.example.com/colar.jpg",
    metadata: { approved_at: "2026-10-01T00:00:00.000Z", package_size: "small" },
    categories: [{ id: "pcat_1" }],
    variants: [{ id: "var_1", length: 20, width: 15, height: 10, weight: 0.5, prices: PRICE }],
    ...overrides,
  }
}

// The form resubmits every field; this is the live product above as the portal sends it.
const unchangedBody = {
  title: "Colar de búzios",
  description: "Feito à mão",
  thumbnail: "https://cdn.example.com/colar.jpg",
  category_id: "pcat_1",
  variants: [{ id: "var_1", prices: PRICE }],
  packageSize: "small",
}

function makeReq(body: unknown, product: Record<string, unknown>) {
  const productService = {
    updateProductVariants: jest.fn(),
    listProductCategories: jest.fn().mockResolvedValue([{ id: "pcat_1" }]),
  }
  const graph = jest.fn(async ({ entity, fields }: any) => {
    if (entity === "seller") {
      return fields.includes("products.id")
        ? { data: [{ id: "seller_1", products: [{ id: "prod_1" }] }] }
        : { data: [{ id: "seller_1", name: "Ateliê Axé" }] }
    }
    return { data: [product] }
  })
  return {
    body,
    params: { id: "prod_1" },
    sellerId: "seller_1",
    scope: {
      resolve: (k: string) =>
        k === Modules.PRODUCT ? productService : k === ContainerRegistrationKeys.QUERY ? { graph } : undefined,
    },
    _productService: productService,
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

function workflowInput() {
  return run.mock.calls[0][0].input.products[0]
}

beforeEach(() => {
  run.mockReset().mockResolvedValue({ result: [{ id: "prod_1" }] })
  notify.mockReset().mockResolvedValue(undefined)
})

describe("PATCH /seller/products/:id — never approved product", () => {
  const draft = () => liveProduct({ status: "draft", metadata: { package_size: "small" } })

  it("rejects publishing directly", async () => {
    const res = makeRes()
    await PATCH(makeReq({ status: "published" }, draft()), res)

    expect(res._status).toBe(400)
    expect(res._body.error).toBe("Produto ainda não aprovado. Envie para análise.")
    expect(run).not.toHaveBeenCalled()
  })

  it("applies content directly while it stays a draft, without alerting", async () => {
    const res = makeRes()
    await PATCH(makeReq({ title: "Colar novo", status: "draft" }, draft()), res)

    expect(res._status).toBe(200)
    expect(workflowInput()).toEqual(expect.objectContaining({ title: "Colar novo", status: "draft" }))
    expect(notify).not.toHaveBeenCalled()
  })

  it("records submitted_at and alerts managers when a draft goes to review", async () => {
    const res = makeRes()
    await PATCH(makeReq({ title: "Colar novo", status: "proposed" }, draft()), res)

    expect(res._status).toBe(200)
    const input = workflowInput()
    expect(input).toEqual(expect.objectContaining({ title: "Colar novo", status: "proposed" }))
    expect(typeof input.metadata.submitted_at).toBe("string")
    expect(notify).toHaveBeenCalledWith(
      { id: "prod_1", title: "Colar de búzios", handle: "colar-de-buzios" },
      "Ateliê Axé",
      "new",
    )
  })

  it("edits a product already in review directly, without a new alert or submitted_at", async () => {
    const proposed = liveProduct({ status: "proposed", metadata: { submitted_at: "2026-10-20T00:00:00.000Z" } })
    const res = makeRes()
    await PATCH(makeReq({ title: "Colar novo", status: "proposed" }, proposed), res)

    expect(res._status).toBe(200)
    expect(workflowInput()).toEqual(expect.objectContaining({ title: "Colar novo", status: "proposed" }))
    expect(workflowInput().metadata).toBeUndefined()
    expect(notify).not.toHaveBeenCalled()
  })

  it("still answers 200 when the managers alert fails", async () => {
    notify.mockRejectedValue(new Error("brevo down"))
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    const res = makeRes()
    await PATCH(makeReq({ status: "proposed" }, draft()), res)

    expect(res._status).toBe(200)
    spy.mockRestore()
  })
})

describe("PATCH /seller/products/:id — approved product", () => {
  it("rejects sending an approved product back to review", async () => {
    const res = makeRes()
    await PATCH(makeReq({ status: "proposed" }, liveProduct()), res)

    expect(res._status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it("stores a content edit as pending_changes and never sends the content to the product", async () => {
    const res = makeRes()
    await PATCH(makeReq({ ...unchangedBody, title: "Colar dourado" }, liveProduct()), res)

    expect(res._status).toBe(200)
    const input = workflowInput()
    expect(input).not.toHaveProperty("title")
    expect(input).not.toHaveProperty("description")
    expect(input).not.toHaveProperty("thumbnail")
    expect(input).not.toHaveProperty("category_ids")
    expect(input.metadata.pending_changes).toEqual({ title: "Colar dourado", submittedAt: expect.any(String) })
    expect(input.metadata.approved_at).toBe("2026-10-01T00:00:00.000Z")
    expect(notify).toHaveBeenCalledWith(
      { id: "prod_1", title: "Colar de búzios", handle: "colar-de-buzios" },
      "Ateliê Axé",
      "change",
    )
    expect(res._body.pendingChanges).toEqual({ title: "Colar dourado", submittedAt: expect.any(String) })
  })

  it("keeps a price change out of the live variants and in pending_changes", async () => {
    const newPrice = [{ amount: 6500, currency_code: "brl" }]
    await PATCH(makeReq({ ...unchangedBody, variants: [{ id: "var_1", prices: newPrice }] }, liveProduct()), makeRes())

    const input = workflowInput()
    expect(input).not.toHaveProperty("variants")
    expect(input.metadata.pending_changes.variants).toEqual([{ id: "var_1", prices: newPrice }])
  })

  it("keeps a package change out of the live variant dimensions", async () => {
    const req = makeReq({ ...unchangedBody, packageSize: "large" }, liveProduct())
    await PATCH(req, makeRes())

    expect(req._productService.updateProductVariants).not.toHaveBeenCalled()
    expect(workflowInput().metadata.package_size).toBe("small")
    expect(workflowInput().metadata.pending_changes.packageSize).toBe("large")
  })

  it("rejects a pending edit that could never be approved (bulky without measures)", async () => {
    const res = makeRes()
    await PATCH(makeReq({ ...unchangedBody, packageSize: "bulky" }, liveProduct()), res)

    expect(res._status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it("rejects a pending edit to a category that does not exist", async () => {
    const req = makeReq({ ...unchangedBody, category_id: "pcat_missing" }, liveProduct())
    req._productService.listProductCategories.mockResolvedValue([])
    const res = makeRes()
    await PATCH(req, res)

    expect(res._status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  // Review Focus 1
  it("writes nothing and alerts nobody when the body is identical to the live product", async () => {
    const res = makeRes()
    await PATCH(makeReq(unchangedBody, liveProduct()), res)

    expect(res._status).toBe(200)
    expect(run).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(res._body.pendingChanges).toBeNull()
  })

  // Review Focus 2
  it("drops an existing pending change when the body goes back to the live values", async () => {
    const product = liveProduct({
      metadata: {
        approved_at: "2026-10-01T00:00:00.000Z",
        package_size: "small",
        pending_changes: { title: "Colar dourado", submittedAt: "2026-10-21T00:00:00.000Z" },
      },
    })
    const res = makeRes()
    await PATCH(makeReq(unchangedBody, product), res)

    expect(res._status).toBe(200)
    expect(workflowInput().metadata).not.toHaveProperty("pending_changes")
    expect(notify).not.toHaveBeenCalled()
    expect(res._body.pendingChanges).toBeNull()
  })

  it("replaces a previous pending change and alerts again when the diff is new", async () => {
    const product = liveProduct({
      metadata: {
        approved_at: "2026-10-01T00:00:00.000Z",
        package_size: "small",
        pending_changes: { title: "Colar dourado", submittedAt: "2026-10-21T00:00:00.000Z" },
      },
    })
    await PATCH(makeReq({ ...unchangedBody, title: "Colar prateado" }, product), makeRes())

    const pending = workflowInput().metadata.pending_changes
    expect(pending.title).toBe("Colar prateado")
    expect(pending.submittedAt).not.toBe("2026-10-21T00:00:00.000Z")
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it("keeps the previous submittedAt and does not alert when the same edit is resubmitted", async () => {
    const product = liveProduct({
      metadata: {
        approved_at: "2026-10-01T00:00:00.000Z",
        package_size: "small",
        pending_changes: { title: "Colar dourado", submittedAt: "2026-10-21T00:00:00.000Z" },
      },
    })
    const res = makeRes()
    await PATCH(makeReq({ ...unchangedBody, title: "Colar dourado" }, product), res)

    expect(res._status).toBe(200)
    expect(run).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(res._body.pendingChanges).toEqual({ title: "Colar dourado", submittedAt: "2026-10-21T00:00:00.000Z" })
  })

  it("applies draft/published status at once without touching content or pending_changes", async () => {
    const pending = { title: "Colar dourado", submittedAt: "2026-10-21T00:00:00.000Z" }
    const product = liveProduct({
      metadata: { approved_at: "2026-10-01T00:00:00.000Z", pending_changes: pending },
    })
    await PATCH(makeReq({ status: "draft" }, product), makeRes())

    const input = workflowInput()
    expect(input.status).toBe("draft")
    expect(input).not.toHaveProperty("title")
    // Status-only bodies must leave the pending edit alone.
    expect(input.metadata?.pending_changes ?? pending).toEqual(pending)
    expect(notify).not.toHaveBeenCalled()
  })

  it("republishes an approved draft at once", async () => {
    const product = liveProduct({ status: "draft" })
    const res = makeRes()
    await PATCH(makeReq({ ...unchangedBody, status: "published" }, product), res)

    expect(res._status).toBe(200)
    expect(workflowInput()).toEqual({ id: "prod_1", status: "published" })
  })

  it("stores an edit to an approved draft as pending too", async () => {
    const product = liveProduct({ status: "draft" })
    await PATCH(makeReq({ ...unchangedBody, title: "Colar dourado" }, product), makeRes())

    expect(workflowInput()).not.toHaveProperty("title")
    expect(workflowInput().metadata.pending_changes.title).toBe("Colar dourado")
  })

  it("stamps approved_at on a published product that predates moderation", async () => {
    const product = liveProduct({ metadata: { package_size: "small" } })
    const res = makeRes()
    await PATCH(makeReq(unchangedBody, product), res)

    expect(res._status).toBe(200)
    const input = workflowInput()
    expect(typeof input.metadata.approved_at).toBe("string")
    expect(input).not.toHaveProperty("title")
    expect(input.metadata).not.toHaveProperty("pending_changes")
  })

  it("still answers 200 when the change alert fails", async () => {
    notify.mockRejectedValue(new Error("brevo down"))
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    const res = makeRes()
    await PATCH(makeReq({ ...unchangedBody, title: "Colar dourado" }, liveProduct()), res)

    expect(res._status).toBe(200)
    spy.mockRestore()
  })
})

describe("GET /seller/products/:id — pending changes", () => {
  it("returns the pending change next to the live product", async () => {
    const pending = { title: "Colar dourado", submittedAt: "2026-10-21T00:00:00.000Z" }
    const product = liveProduct({ metadata: { approved_at: "2026-10-01T00:00:00.000Z", pending_changes: pending } })
    const res = makeRes()
    await GET(makeReq(undefined, product), res)

    expect(res._body.product.title).toBe("Colar de búzios")
    expect(res._body.pendingChanges).toEqual(pending)
  })

  it("returns pendingChanges null when there is none", async () => {
    const res = makeRes()
    await GET(makeReq(undefined, liveProduct()), res)

    expect(res._body.pendingChanges).toBeNull()
  })
})
