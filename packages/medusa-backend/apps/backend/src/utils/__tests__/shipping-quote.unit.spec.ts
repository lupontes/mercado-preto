import { QuoteCache, quoteShipping } from "../shipping-quote"
import type { ServiceQuote } from "../melhor-envio"

const addressA = {
  addressPostalCode: "44300000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
}
const addressB = { ...addressA, addressPostalCode: "40026010", addressCity: "Salvador" }

// Two graph calls: variants first, then products with their seller.
function makeQuery(opts: { variants: any[]; products: any[] }) {
  return {
    graph: jest.fn(async ({ entity }: any) => ({ data: entity === "product_variant" ? opts.variants : opts.products })),
  }
}

const variants = [
  { id: "var-a1", product_id: "prod-a", weight: 0.2, length: 15, width: 15, height: 15, prices: [{ amount: 7700, currency_code: "brl" }] },
  { id: "var-a2", product_id: "prod-a", weight: 0, length: 0, width: 0, height: 0, prices: [{ amount: 5000, currency_code: "brl" }] },
  { id: "var-b1", product_id: "prod-b", weight: 1, length: 30, width: 20, height: 10, prices: [{ amount: 12000, currency_code: "brl" }] },
]
const products = [
  { id: "prod-a", title: "Colar", seller: { id: "seller-a", name: "Loja A", ...addressA } },
  { id: "prod-b", title: "Bolsa", seller: { id: "seller-b", name: "Loja B", ...addressB } },
]

const quotesByOrigin: Record<string, ServiceQuote[]> = {
  "44300000": [
    { service: "PAC", serviceId: 1, price: 3000, deliveryDays: 9 },
    { service: "SEDEX", serviceId: 2, price: 6000, deliveryDays: 4 },
  ],
  "40026010": [
    { service: "PAC", serviceId: 1, price: 2000, deliveryDays: 7 },
    { service: "SEDEX", serviceId: 2, price: 5000, deliveryDays: 3 },
  ],
}

function makeCalculator(overrides: Record<string, ServiceQuote[] | Error> = {}) {
  return jest.fn(async ({ fromPostalCode }: any) => {
    const v = overrides[fromPostalCode] ?? quotesByOrigin[fromPostalCode]
    if (v instanceof Error) throw v
    return v
  })
}

const items = [
  { variantId: "var-a1", quantity: 2 },
  { variantId: "var-a2", quantity: 1 },
  { variantId: "var-b1", quantity: 1 },
]

describe("quoteShipping", () => {
  it("sums PAC into Econômico and SEDEX into Rápido, with the slowest seller plus handling days", async () => {
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products }), calculator: makeCalculator(), cache: new QuoteCache(), handlingDays: 2 },
      { postalCode: "01310100", items }
    )

    expect(quote.unavailableSellers).toEqual([])
    expect(quote.options).toEqual([
      expect.objectContaining({ tier: "economico", label: "Econômico", total: 5000, deliveryDays: 11 }),
      expect.objectContaining({ tier: "rapido", label: "Rápido", total: 11000, deliveryDays: 6 }),
    ])
    expect(quote.options[0].sellers).toEqual([
      { sellerId: "seller-a", sellerName: "Loja A", tier: "economico", service: "PAC", serviceId: 1, price: 3000, deliveryDays: 9 },
      { sellerId: "seller-b", sellerName: "Loja B", tier: "economico", service: "PAC", serviceId: 1, price: 2000, deliveryDays: 7 },
    ])
  })

  it("sends one request per seller with quantities, real dimensions, medium fallback and declared value", async () => {
    const calculator = makeCalculator()
    await quoteShipping(
      { query: makeQuery({ variants, products }), calculator, cache: new QuoteCache() },
      { postalCode: "01310100", items }
    )

    expect(calculator).toHaveBeenCalledTimes(2)
    expect(calculator).toHaveBeenCalledWith({
      fromPostalCode: "44300000",
      toPostalCode: "01310100",
      products: [
        { id: "var-a1", weight: 0.2, length: 15, width: 15, height: 15, insuranceValue: 7700, quantity: 2 },
        { id: "var-a2", weight: 1, length: 25, width: 20, height: 10, insuranceValue: 5000, quantity: 1 },
      ],
    })
  })

  it("normalizes the destination postal code", async () => {
    const calculator = makeCalculator()
    await quoteShipping(
      { query: makeQuery({ variants, products }), calculator, cache: new QuoteCache() },
      { postalCode: " 01310-100 ", items }
    )
    expect(calculator.mock.calls[0][0].toPostalCode).toBe("01310100")
  })

  it("marks a seller without a complete address as missing_address and does not quote it", async () => {
    const noAddress = [products[0], { ...products[1], seller: { id: "seller-b", name: "Loja B" } }]
    const calculator = makeCalculator()
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products: noAddress }), calculator, cache: new QuoteCache() },
      { postalCode: "01310100", items }
    )
    expect(quote.unavailableSellers).toEqual([
      { sellerId: "seller-b", sellerName: "Loja B", reason: "missing_address", productTitles: ["Bolsa"] },
    ])
    expect(calculator).toHaveBeenCalledTimes(1)
  })

  it("marks a seller with an item above the Correios limits as oversized", async () => {
    const big = variants.map((v) => (v.id === "var-b1" ? { ...v, length: 120 } : v))
    const quote = await quoteShipping(
      { query: makeQuery({ variants: big, products }), calculator: makeCalculator(), cache: new QuoteCache() },
      { postalCode: "01310100", items }
    )
    expect(quote.unavailableSellers[0]).toEqual(expect.objectContaining({ sellerId: "seller-b", reason: "oversized" }))
  })

  it("marks a seller as quote_failed when Melhor Envio errors or returns no Correios service", async () => {
    const logger = { error: jest.fn() }
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products }), calculator: makeCalculator({ "40026010": new Error("timeout") }), cache: new QuoteCache(), logger },
      { postalCode: "01310100", items }
    )
    expect(quote.unavailableSellers).toEqual([expect.objectContaining({ sellerId: "seller-b", reason: "quote_failed" })])
    expect(logger.error).toHaveBeenCalled()
  })

  it("marks every seller as quote_failed when no calculator is configured", async () => {
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products }), calculator: null, cache: new QuoteCache(), logger: { error: jest.fn() } },
      { postalCode: "01310100", items }
    )
    expect(quote.options).toEqual([])
    expect(quote.unavailableSellers.map((u) => u.reason)).toEqual(["quote_failed", "quote_failed"])
  })

  it("omits a tier when any seller lacks that service", async () => {
    const quote = await quoteShipping(
      {
        query: makeQuery({ variants, products }),
        calculator: makeCalculator({ "40026010": [{ service: "PAC", serviceId: 1, price: 2000, deliveryDays: 7 }] }),
        cache: new QuoteCache(),
      },
      { postalCode: "01310100", items }
    )
    expect(quote.options.map((o) => o.tier)).toEqual(["economico"])
  })

  it("serves repeated quotes from the cache until the TTL expires", async () => {
    let now = 0
    const cache = new QuoteCache(10 * 60 * 1000, () => now)
    const calculator = makeCalculator()
    const deps = { query: makeQuery({ variants, products }), calculator, cache }
    await quoteShipping(deps, { postalCode: "01310100", items })
    await quoteShipping(deps, { postalCode: "01310100", items })
    expect(calculator).toHaveBeenCalledTimes(2) // two sellers, first call only
    now = 10 * 60 * 1000 + 1
    await quoteShipping(deps, { postalCode: "01310100", items })
    expect(calculator).toHaveBeenCalledTimes(4)
  })

  it("does not cache an empty quote list, so the next call quotes again", async () => {
    const cache = new QuoteCache()
    const calculator = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue(quotesByOrigin["44300000"])
    const deps = { query: makeQuery({ variants, products: [products[0]] }), calculator, cache }
    const onlyA = { postalCode: "01310100", items: [{ variantId: "var-a1", quantity: 1 }] }

    const first = await quoteShipping(deps, onlyA)
    expect(first.unavailableSellers.map((u) => u.reason)).toEqual(["quote_failed"])
    const second = await quoteShipping(deps, onlyA)
    expect(calculator).toHaveBeenCalledTimes(2)
    expect(second.options.map((o) => o.tier)).toEqual(["economico", "rapido"])
  })

  it("throws for a variant that does not exist", async () => {
    await expect(
      quoteShipping(
        { query: makeQuery({ variants, products }), calculator: makeCalculator(), cache: new QuoteCache() },
        { postalCode: "01310100", items: [{ variantId: "nope", quantity: 1 }] }
      )
    ).rejects.toThrow("nope")
  })
})
