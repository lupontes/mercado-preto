import { Modules } from "@medusajs/framework/utils"
import { signLabelToken } from "../../../../utils/label-token"
import { GET } from "../route"

jest.mock("../../../../utils/melhor-envio-labels", () => ({ getLabelClient: jest.fn() }))
import { getLabelClient } from "../../../../utils/melhor-envio-labels"

const NOT_FOUND = "Etiqueta não encontrada ou expirada."

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown, _headers: {} as Record<string, string> } as any
  res.status = (c: number) => { res._status = c; return res }
  res.send = (b: unknown) => { res._body = b; return res }
  res.redirect = (c: number, url: string) => { res._status = c; res._headers.Location = url; return res }
  res.setHeader = (k: string, v: string) => { res._headers[k] = v; return res }
  return res
}

function makeReq(token: string, order: any, logger = { error: jest.fn() }) {
  const retrieveOrder = jest.fn().mockResolvedValue(order)
  const scope = {
    resolve: (key: string) => {
      if (key === Modules.ORDER) return { retrieveOrder }
      if (key === "logger") return logger
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  return { req: { params: { token }, scope } as any, retrieveOrder, logger }
}

const generated = { metadata: { shipping_label: { status: "generated", meOrderIds: ["me_1", "me_2"] } } }

describe("GET /labels/:token", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret"
    ;(getLabelClient as jest.Mock).mockReset()
  })

  it("redirects 302 to a fresh print url for a generated label", async () => {
    const printUrl = jest.fn().mockResolvedValue("https://me.example/print/abc")
    ;(getLabelClient as jest.Mock).mockReturnValue({ printUrl })
    const { req, retrieveOrder } = makeReq(signLabelToken("order_1"), generated)
    const res = makeRes()
    await GET(req, res)
    expect(retrieveOrder).toHaveBeenCalledWith("order_1", expect.objectContaining({ select: expect.arrayContaining(["metadata"]) }))
    expect(printUrl).toHaveBeenCalledWith(["me_1", "me_2"])
    expect(res._status).toBe(302)
    expect(res._headers.Location).toBe("https://me.example/print/abc")
    expect(res._headers["Cache-Control"]).toBe("no-store")
  })

  it.each([
    ["an invalid token", "garbage", generated],
    ["an expired token", signLabelToken("order_1", new Date(0)), generated],
    ["a label that is not generated", signLabelToken("order_1"), { metadata: { shipping_label: { status: "failed", meOrderIds: ["me_1"] } } }],
    ["an order without a label", signLabelToken("order_1"), { metadata: {} }],
  ])("answers 404 without Location for %s", async (_name, token, order) => {
    const printUrl = jest.fn()
    ;(getLabelClient as jest.Mock).mockReturnValue({ printUrl })
    const { req } = makeReq(token as string, order)
    const res = makeRes()
    await GET(req, res)
    expect(res._status).toBe(404)
    expect(res._body).toBe(NOT_FOUND)
    expect(res._headers.Location).toBeUndefined()
    expect(res._headers["Cache-Control"]).toBe("no-store")
    expect(printUrl).not.toHaveBeenCalled()
  })

  it("answers 404 when the order cannot be loaded", async () => {
    const { req, retrieveOrder } = makeReq(signLabelToken("order_1"), generated)
    retrieveOrder.mockRejectedValue(new Error("not found"))
    const res = makeRes()
    await GET(req, res)
    expect(res._status).toBe(404)
    expect(res._body).toBe(NOT_FOUND)
  })

  it("answers 404 when labels are not configured", async () => {
    ;(getLabelClient as jest.Mock).mockReturnValue(null)
    const { req } = makeReq(signLabelToken("order_1"), generated)
    const res = makeRes()
    await GET(req, res)
    expect(res._status).toBe(404)
    expect(res._body).toBe(NOT_FOUND)
    expect(res._headers.Location).toBeUndefined()
  })

  it("logs and answers 404 without details when printUrl throws", async () => {
    ;(getLabelClient as jest.Mock).mockReturnValue({ printUrl: jest.fn().mockRejectedValue(new Error("boom secret")) })
    const { req, logger } = makeReq(signLabelToken("order_1"), generated)
    const res = makeRes()
    await GET(req, res)
    expect(res._status).toBe(404)
    expect(res._body).toBe(NOT_FOUND)
    expect(res._headers.Location).toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})
