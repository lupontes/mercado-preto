import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const purchase = jest.fn()
const resume = jest.fn()
const notify = jest.fn()
const cancel = jest.fn()
jest.mock("../../../../../../utils/shipping-label", () => ({ purchaseShippingLabel: (...a: any[]) => purchase(...a), resumeStalePurchase: (...a: any[]) => resume(...a) }))
jest.mock("../../../../../../utils/shipping-label-notify", () => ({ notifySellerLabelReady: (...a: any[]) => notify(...a) }))
jest.mock("../../../../../../utils/melhor-envio-labels", () => ({ getLabelClient: () => ({ cancel }) }))
jest.mock("../../../../../../utils/melhor-envio", () => ({ getShippingCalculator: () => ({}) }))
jest.mock("../../../../../../utils/label-token", () => ({ labelLink: (id: string) => `https://api/labels/${id}` }))

import { DELETE, GET, POST } from "../route"

const label = (over: Record<string, unknown> = {}) => ({
  status: "failed", meOrderIds: ["me1", "me2"], price: 1500, paid: true, pendingSince: null,
  trackingCode: null, generatedAt: null, postBy: null, reminderSentAt: null, error: "x", ...over,
})

function setup(metadata: Record<string, unknown>) {
  const updateOrders = jest.fn().mockResolvedValue({})
  const retrieveOrder = jest.fn().mockResolvedValue({ id: "order_1", display_id: 7, metadata })
  const retrieveSeller = jest.fn().mockResolvedValue({ name: "Ana", phone: "1", email: "a@b.c" })
  const services: Record<string, unknown> = {
    [Modules.ORDER]: { retrieveOrder, updateOrders },
    seller: { retrieveSeller },
    [ContainerRegistrationKeys.QUERY]: {},
  }
  const req = { params: { id: "order_1" }, scope: { resolve: (k: string) => services[k] } } as any
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return { req, res, updateOrders }
}

beforeEach(() => jest.clearAllMocks())

describe("POST /admin/orders/:id/shipping-label", () => {
  it("buys again from failed and notifies the seller when it generates", async () => {
    const { req, res } = setup({ seller_id: "s1", shipping_label: label() })
    purchase.mockResolvedValue(label({ status: "generated" }))
    await POST(req, res)
    expect(purchase).toHaveBeenCalledWith(expect.objectContaining({ labels: { cancel } }), "order_1")
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ name: "Ana" }), { id: "order_1", displayId: 7 }, expect.objectContaining({ status: "generated" }))
    expect(res._body.shipping_label.status).toBe("generated")
  })

  it("does not notify when the purchase fails again", async () => {
    const { req, res } = setup({ seller_id: "s1", shipping_label: label() })
    purchase.mockResolvedValue(label())
    await POST(req, res)
    expect(notify).not.toHaveBeenCalled()
  })

  it.each(["generated", "canceled"])("answers 409 for status %s", async (status) => {
    const { req, res } = setup({ shipping_label: label({ status }) })
    await POST(req, res)
    expect(res._status).toBe(409)
    expect(purchase).not.toHaveBeenCalled()
  })

  it("answers 409 for a recent pending", async () => {
    const { req, res } = setup({ shipping_label: label({ status: "pending", pendingSince: new Date().toISOString() }) })
    await POST(req, res)
    expect(res._status).toBe(409)
  })

  it("delegates a stale pending to resumeStalePurchase under the purchase lock", async () => {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString()
    const { req, res, updateOrders } = setup({ seller_id: "s1", shipping_label: label({ status: "pending", pendingSince: stale, error: null }) })
    resume.mockResolvedValue(label({ status: "generated" }))
    await POST(req, res)
    expect(resume).toHaveBeenCalledWith(expect.anything(), "order_1", 15 * 60 * 1000)
    expect(purchase).not.toHaveBeenCalled()
    expect(updateOrders).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalled()
  })

  it("maps a resume conflict to 409", async () => {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString()
    const { req, res } = setup({ shipping_label: label({ status: "pending", pendingSince: stale }) })
    resume.mockResolvedValue({ conflict: "em andamento" })
    await POST(req, res)
    expect(res._status).toBe(409)
    expect(res._body.error).toBe("em andamento")
    expect(notify).not.toHaveBeenCalled()
  })

  it("answers 409 when there is no label state", async () => {
    const { req, res } = setup({})
    await POST(req, res)
    expect(res._status).toBe(409)
  })
})

describe("DELETE /admin/orders/:id/shipping-label", () => {
  it("cancels every Melhor Envio id and saves canceled", async () => {
    const { req, res, updateOrders } = setup({ shipping_status: "awaiting_shipment", seller_id: "s1", shipping_label: label({ status: "generated" }) })
    await DELETE(req, res)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledWith("me1")
    expect(cancel).toHaveBeenCalledWith("me2")
    const saved = updateOrders.mock.calls[0][1].metadata
    expect(saved.seller_id).toBe("s1")
    expect(saved.shipping_label.status).toBe("canceled")
  })

  it("answers 409 Etiqueta já postada once shipped", async () => {
    const { req, res, updateOrders } = setup({ shipping_status: "shipped", shipping_label: label({ status: "generated" }) })
    await DELETE(req, res)
    expect(res._status).toBe(409)
    expect(res._body.error).toBe("Etiqueta já postada")
    expect(cancel).not.toHaveBeenCalled()
    expect(updateOrders).not.toHaveBeenCalled()
  })

  it("answers 409 when the label is not generated", async () => {
    const { req, res } = setup({ shipping_status: "awaiting_shipment", shipping_label: label({ status: "failed" }) })
    await DELETE(req, res)
    expect(res._status).toBe(409)
  })

  it("keeps the label generated when Melhor Envio refuses the cancel", async () => {
    cancel.mockRejectedValueOnce(new Error("boom"))
    const { req, res, updateOrders } = setup({ shipping_status: "awaiting_shipment", shipping_label: label({ status: "generated" }) })
    await DELETE(req, res)
    expect(res._status).toBe(502)
    expect(updateOrders).not.toHaveBeenCalled()
  })
})

describe("GET /admin/orders/:id/shipping-label", () => {
  it("returns the state and the signed print link", async () => {
    const { req, res } = setup({ shipping_label: label({ status: "generated" }) })
    await GET(req, res)
    expect(res._body.link).toBe("https://api/labels/order_1")
  })
})
