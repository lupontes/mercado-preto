import { Modules } from "@medusajs/framework/utils"
import { GET } from "../route"

jest.mock("../../../../../../utils/melhor-envio-labels", () => ({ getLabelClient: jest.fn() }))
import { getLabelClient } from "../../../../../../utils/melhor-envio-labels"

const NOT_FOUND = "Etiqueta não encontrada ou expirada."

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown, _headers: {} as Record<string, string> } as any
  res.status = (c: number) => { res._status = c; return res }
  res.send = (b: unknown) => { res._body = b; return res }
  res.setHeader = (k: string, v: string) => { res._headers[k] = v; return res }
  res.redirect = (c: number, url: string) => { res._status = c; res._headers.Location = url; return res }
  return res
}

function makeReq(order: any | Error, sellerId = "seller_1") {
  const retrieveOrder = order instanceof Error ? jest.fn().mockRejectedValue(order) : jest.fn().mockResolvedValue(order)
  const logger = { error: jest.fn() }
  const scope = {
    resolve: (key: string) => {
      if (key === Modules.ORDER) return { retrieveOrder }
      if (key === "logger") return logger
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  return { sellerId, params: { id: "order_1" }, scope } as any
}

const label = { status: "generated", meOrderIds: ["me_1"] }

describe("GET /seller/orders/:id/label", () => {
  beforeEach(() => (getLabelClient as jest.Mock).mockReset())

  it("redirects 302 for an order of the seller with a generated label", async () => {
    const printUrl = jest.fn().mockResolvedValue("https://me.example/print/abc")
    ;(getLabelClient as jest.Mock).mockReturnValue({ printUrl })
    const res = makeRes()
    await GET(makeReq({ metadata: { seller_id: "seller_1", shipping_label: label } }), res)
    expect(printUrl).toHaveBeenCalledWith(["me_1"])
    expect(res._status).toBe(302)
    expect(res._headers.Location).toBe("https://me.example/print/abc")
  })

  it("answers 404 for an order of another store, without calling Melhor Envio", async () => {
    const printUrl = jest.fn()
    ;(getLabelClient as jest.Mock).mockReturnValue({ printUrl })
    const res = makeRes()
    await GET(makeReq({ metadata: { seller_id: "seller_2", shipping_label: label } }), res)
    expect(res._status).toBe(404)
    expect(res._body).toBe(NOT_FOUND)
    expect(res._headers.Location).toBeUndefined()
    expect(printUrl).not.toHaveBeenCalled()
  })

  it("answers 404 when the label is not generated", async () => {
    ;(getLabelClient as jest.Mock).mockReturnValue({ printUrl: jest.fn() })
    const res = makeRes()
    await GET(makeReq({ metadata: { seller_id: "seller_1", shipping_label: { status: "pending", meOrderIds: [] } } }), res)
    expect(res._status).toBe(404)
    expect(res._body).toBe(NOT_FOUND)
  })

  it("answers 404 when the order does not exist", async () => {
    const res = makeRes()
    await GET(makeReq(new Error("not found")), res)
    expect(res._status).toBe(404)
  })

  it("answers 404 and logs when printUrl fails", async () => {
    ;(getLabelClient as jest.Mock).mockReturnValue({ printUrl: jest.fn().mockRejectedValue(new Error("boom")) })
    const req = makeReq({ metadata: { seller_id: "seller_1", shipping_label: label } })
    const res = makeRes()
    await GET(req, res)
    expect(res._status).toBe(404)
    expect(res._body).toBe(NOT_FOUND)
    expect(res._headers.Location).toBeUndefined()
  })
})
