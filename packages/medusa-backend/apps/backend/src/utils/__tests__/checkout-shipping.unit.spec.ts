jest.mock("../shipping-quote", () => ({ ...jest.requireActual("../shipping-quote"), quoteShipping: jest.fn() }))
import { BuyerFacingError, CART_ITEM_UNAVAILABLE_MESSAGE, quoteShipping, type ShippingOption } from "../shipping-quote"
import { resolveCheckoutShipping } from "../checkout-shipping"

const option = (tier: "economico" | "rapido", total: number): ShippingOption => ({
  tier, label: tier === "economico" ? "Econômico" : "Rápido", total, deliveryDays: 11,
  sellers: [{ sellerId: "s1", sellerName: "Loja", tier, service: tier === "economico" ? "PAC" : "SEDEX", serviceId: 1, price: total, deliveryDays: 9 }],
})
const request: any = {
  items: [{ title: "Colar", quantity: 2, price: 7700, variantId: "var-1", productId: "prod-1" }],
  address: { cep: "01310-100" },
  shipping: { tier: "economico", expectedTotal: 3679 },
}
const deps: any = { query: {}, calculator: jest.fn() }

describe("resolveCheckoutShipping", () => {
  beforeEach(() => (quoteShipping as jest.Mock).mockReset())

  it("re-quotes with the cart variants and the delivery CEP and returns the chosen option", async () => {
    ;(quoteShipping as jest.Mock).mockResolvedValue({ options: [option("economico", 3679), option("rapido", 7572)], unavailableSellers: [] })
    const result = await resolveCheckoutShipping(deps, request)
    expect(quoteShipping).toHaveBeenCalledWith(expect.objectContaining({ query: deps.query, calculator: deps.calculator }), {
      postalCode: "01310-100",
      items: [{ variantId: "var-1", quantity: 2 }],
    })
    expect(result).toEqual({ ok: true, option: option("economico", 3679) })
  })

  it("answers 409 with the new quote when the price changed", async () => {
    const quote = { options: [option("economico", 3900)], unavailableSellers: [] }
    ;(quoteShipping as jest.Mock).mockResolvedValue(quote)
    const result = await resolveCheckoutShipping(deps, request)
    expect(result).toEqual({ ok: false, status: 409, body: { error: "O valor do frete foi atualizado", quote } })
  })

  it("answers 422 when a seller became unavailable or the tier vanished", async () => {
    const unavailable = { options: [option("economico", 3679)], unavailableSellers: [{ sellerId: "s2", sellerName: "Loja 2", reason: "missing_address", productTitles: ["Bolsa"] }] }
    ;(quoteShipping as jest.Mock).mockResolvedValue(unavailable)
    expect(await resolveCheckoutShipping(deps, request)).toEqual({
      ok: false, status: 422,
      body: { error: "Frete indisponível para alguns produtos do carrinho", quote: unavailable },
    })

    const noTier = { options: [option("rapido", 7572)], unavailableSellers: [] }
    ;(quoteShipping as jest.Mock).mockResolvedValue(noTier)
    expect(await resolveCheckoutShipping(deps, request)).toEqual({
      ok: false, status: 422, body: { error: "Opção de frete indisponível", quote: noTier },
    })
  })

  it("answers 400 with the buyer message when the quote fails for an unknown variant or seller", async () => {
    ;(quoteShipping as jest.Mock).mockRejectedValue(new BuyerFacingError(CART_ITEM_UNAVAILABLE_MESSAGE))
    expect(await resolveCheckoutShipping(deps, request)).toEqual({
      ok: false, status: 400, body: { error: CART_ITEM_UNAVAILABLE_MESSAGE },
    })
  })

  it("does not leak an infra error: logs it and answers a generic 502", async () => {
    const logger = { error: jest.fn() }
    ;(quoteShipping as jest.Mock).mockRejectedValue(new Error("connection refused 10.0.0.5:5432"))
    const result = await resolveCheckoutShipping({ ...deps, logger }, request)
    expect(result).toEqual({
      ok: false, status: 502, body: { error: "Não foi possível calcular o frete agora. Tente novamente em instantes." },
    })
    expect(JSON.stringify(result)).not.toContain("connection refused")
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("connection refused"))
  })

  it("does not leak when query.graph itself rejects (real quoteShipping)", async () => {
    ;(quoteShipping as jest.Mock).mockImplementation(jest.requireActual("../shipping-quote").quoteShipping)
    const query = { graph: jest.fn().mockRejectedValue(new Error("connection refused")) }
    const result: any = await resolveCheckoutShipping({ ...deps, query, logger: { error: jest.fn() } }, request)
    expect(result.status).toBe(502)
    expect(result.body.error).not.toContain("connection refused")
  })
})
