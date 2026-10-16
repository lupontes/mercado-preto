import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("../../../../../utils/shipping-quote", () => ({
  quoteShipping: jest.fn(),
  defaultQuoteCache: {},
}))
jest.mock("../../../../../utils/melhor-envio", () => ({ getShippingCalculator: jest.fn(() => "calculator") }))

import { quoteShipping } from "../../../../../utils/shipping-quote"
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
    ]) {
      const res = makeRes()
      await POST(makeReq(body), res)
      expect(res._status).toBe(400)
    }
    expect(quoteShipping).not.toHaveBeenCalled()
  })

  it("answers 400 when a variant does not exist", async () => {
    ;(quoteShipping as jest.Mock).mockRejectedValue(new Error("Um produto do seu carrinho não está mais disponível. Remova-o e tente novamente."))
    const res = makeRes()
    await POST(makeReq({ postalCode: "01310100", items: [{ variantId: "v9", quantity: 1 }] }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe("Um produto do seu carrinho não está mais disponível. Remova-o e tente novamente.")
  })
})
