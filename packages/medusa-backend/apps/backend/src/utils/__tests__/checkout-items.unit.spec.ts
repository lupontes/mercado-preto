import type { CheckoutRequest } from "../checkout-payload"
import { PRICE_CHANGED_MESSAGE, resolveCheckoutItems } from "../checkout-items"
import { CART_ITEM_UNAVAILABLE_MESSAGE } from "../shipping-quote"

type Variant = { id: string; prices: { amount: number; currency_code: string }[]; product: { title: string } }

const variants: Record<string, Variant> = {
  "var-1": { id: "var-1", prices: [{ amount: 7900, currency_code: "brl" }], product: { title: "Cesto de palha" } },
  "var-2": { id: "var-2", prices: [{ amount: 5000, currency_code: "brl" }], product: { title: "Boné de palha" } },
  "var-usd": { id: "var-usd", prices: [{ amount: 900, currency_code: "usd" }], product: { title: "Só dólar" } },
}

function makeQuery() {
  return {
    graph: jest.fn(async ({ filters }: any) => ({
      data: filters.id.filter((id: string) => variants[id]).map((id: string) => variants[id]),
    })),
  }
}

const line = (overrides: Partial<CheckoutRequest["items"][number]> = {}): CheckoutRequest["items"][number] => ({
  title: "X", quantity: 1, price: 7900, variantId: "var-1", productId: "prod-1", ...overrides,
})

describe("resolveCheckoutItems", () => {
  it("uses the database price and product title", async () => {
    const query = makeQuery()
    const result = await resolveCheckoutItems(query, [line({ quantity: 3 })])

    expect(query.graph).toHaveBeenCalledTimes(1)
    expect(query.graph).toHaveBeenCalledWith({
      entity: "product_variant",
      fields: ["id", "prices.amount", "prices.currency_code", "product.title"],
      filters: { id: ["var-1"] },
    })
    expect(result).toEqual({
      ok: true,
      items: [{ title: "Cesto de palha", quantity: 3, price: 7900, variantId: "var-1", productId: "prod-1" }],
    })
  })

  it("title-only difference does not block", async () => {
    const result = await resolveCheckoutItems(makeQuery(), [line({ title: "Outro nome" })])
    if (!result.ok) throw new Error("expected ok")
    expect(result.items[0].title).toBe("Cesto de palha")
  })

  it("answers 409 listing only the changed variants", async () => {
    const result = await resolveCheckoutItems(makeQuery(), [
      line({ price: 7000 }),
      line({ variantId: "var-2", productId: "prod-2", price: 5000 }),
    ])
    expect(result).toEqual({
      ok: false,
      status: 409,
      body: { error: PRICE_CHANGED_MESSAGE, priceChanges: [{ variantId: "var-1", price: 7900, title: "Cesto de palha" }] },
    })
  })

  it("answers 400 when the variant is gone", async () => {
    const result = await resolveCheckoutItems(makeQuery(), [line({ variantId: "var-gone" })])
    expect(result).toEqual({ ok: false, status: 400, body: { error: CART_ITEM_UNAVAILABLE_MESSAGE } })
  })

  it("answers 400 when there is no brl price", async () => {
    const result = await resolveCheckoutItems(makeQuery(), [line({ variantId: "var-usd" })])
    expect(result).toEqual({ ok: false, status: 400, body: { error: CART_ITEM_UNAVAILABLE_MESSAGE } })
  })

  it("answers 400 when the brl price is zero", async () => {
    variants["var-zero"] = { id: "var-zero", prices: [{ amount: 0, currency_code: "brl" }], product: { title: "Grátis" } }
    const result = await resolveCheckoutItems(makeQuery(), [line({ variantId: "var-zero" })])
    expect(result).toEqual({ ok: false, status: 400, body: { error: CART_ITEM_UNAVAILABLE_MESSAGE } })
  })

  it.each([
    ["fractional", 79.5],
    ["negative", -7900],
  ])("answers 400 when the brl price is %s", async (_label, amount) => {
    variants["var-bad-price"] = { id: "var-bad-price", prices: [{ amount, currency_code: "brl" }], product: { title: "Preço ruim" } }
    const result = await resolveCheckoutItems(makeQuery(), [line({ variantId: "var-bad-price", price: amount })])
    expect(result).toEqual({ ok: false, status: 400, body: { error: CART_ITEM_UNAVAILABLE_MESSAGE } })
  })

  it("answers 400 instead of using the client's title when the product title is missing", async () => {
    variants["var-untitled"] = { id: "var-untitled", prices: [{ amount: 7900, currency_code: "brl" }] } as unknown as Variant
    const result = await resolveCheckoutItems(makeQuery(), [line({ variantId: "var-untitled", title: "Título do navegador" })])
    expect(result).toEqual({ ok: false, status: 400, body: { error: CART_ITEM_UNAVAILABLE_MESSAGE } })
  })

  it("keeps duplicate variant lines", async () => {
    const query = makeQuery()
    const result = await resolveCheckoutItems(query, [line({ quantity: 1 }), line({ quantity: 2 })])
    if (!result.ok) throw new Error("expected ok")
    expect(result.items.map((i) => [i.quantity, i.price])).toEqual([[1, 7900], [2, 7900]])
    expect(query.graph).toHaveBeenCalledWith(expect.objectContaining({ filters: { id: ["var-1"] } }))
  })
})
