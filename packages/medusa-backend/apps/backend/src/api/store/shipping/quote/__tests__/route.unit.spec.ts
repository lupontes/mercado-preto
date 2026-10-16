import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("../../../../../utils/shipping-quote", () => ({
  ...jest.requireActual("../../../../../utils/shipping-quote"),
  quoteShipping: jest.fn(),
  defaultQuoteCache: {},
}))
jest.mock("../../../../../utils/melhor-envio", () => ({ getShippingCalculator: jest.fn(() => "calculator") }))

import { BuyerFacingError, CART_ITEM_UNAVAILABLE_MESSAGE, quoteShipping } from "../../../../../utils/shipping-quote"
import { POST } from "../route"

function makeReq(body: unknown) {
  const logger = { error: jest.fn() }
  return {
    body,
    scope: { resolve: (k: string) => (k === ContainerRegistrationKeys.QUERY ? { graph: jest.fn() } : k === "logger" ? logger : undefined) },
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("POST /store/shipping/quote", () => {
  beforeEach(() => (quoteShipping as jest.Mock).mockReset())

  it("returns the quote for valid input", async () => {
    ;(quoteShipping as jest.Mock).mockResolvedValue({ options: [], unavailableSellers: [] })
    const res = makeRes()
    await POST(makeReq({ postalCode: "01310-100", items: [{ variantId: "v1", quantity: 2 }] }), res)
    expect(res._status).toBe(200)
    expect(res._body).toEqual({ options: [], unavailableSellers: [] })
    expect((quoteShipping as jest.Mock).mock.calls[0][1]).toEqual({ postalCode: "01310-100", items: [{ variantId: "v1", quantity: 2 }] })
    expect((quoteShipping as jest.Mock).mock.calls[0][0].calculator).toBe("calculator")
  })

  it("rejects an invalid postal code or empty cart with 400", async () => {
    for (const body of [
      { postalCode: "123", items: [{ variantId: "v1", quantity: 1 }] },
      { postalCode: "01310100", items: [] },
      { postalCode: "01310100", items: [{ variantId: "v1", quantity: 0 }] },
      { postalCode: "01310100", items: Array.from({ length: 51 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 })) },
    ]) {
      const res = makeRes()
      await POST(makeReq(body), res)
      expect(res._status).toBe(400)
    }
    expect(quoteShipping).not.toHaveBeenCalled()
  })

  it("answers 400 with the buyer message when a variant does not exist", async () => {
    ;(quoteShipping as jest.Mock).mockRejectedValue(new BuyerFacingError(CART_ITEM_UNAVAILABLE_MESSAGE))
    const res = makeRes()
    await POST(makeReq({ postalCode: "01310100", items: [{ variantId: "v9", quantity: 1 }] }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe(CART_ITEM_UNAVAILABLE_MESSAGE)
  })

  it("does not leak an infra error: logs it and answers a generic 502", async () => {
    ;(quoteShipping as jest.Mock).mockRejectedValue(new Error("connection refused 10.0.0.5:5432"))
    const req = makeReq({ postalCode: "01310100", items: [{ variantId: "v1", quantity: 1 }] })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(502)
    expect(res._body).toEqual({ error: "Não foi possível calcular o frete agora. Tente novamente em instantes." })
    expect(JSON.stringify(res._body)).not.toContain("connection refused")
    expect(req.scope.resolve("logger").error).toHaveBeenCalledWith(expect.stringContaining("connection refused"))
  })
})
