import { afterEach, describe, expect, it, vi } from "vitest"
import { getProduct, getProductReviews, getSellerProducts } from "../api"

describe("getSellerProducts", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not use the default 60s cache — a seller who just published a product must see it on their own store page immediately, not up to a minute later", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await getSellerProducts("seller_1")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/seller_1/products"),
      expect.objectContaining({ next: { revalidate: 0 } })
    )
  })

  it("still returns the parsed products", async () => {
    const products = [{ id: "prod_1", title: "Produto" }]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await getSellerProducts("seller_1")

    expect(result.products).toEqual(products)
  })
})

describe("getProduct", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("requests the seller's name and phone alongside the product — needed for the WhatsApp contact button", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await getProduct("cesta-de-vime")

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain("fields=")
    expect(url).toContain("seller.name")
    expect(url).toContain("seller.phone")
  })
})

describe("getProductReviews", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("fetches reviews for the given product id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviews: [], average: null, count: 0 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await getProductReviews("prod_1")

    expect(fetchMock.mock.calls[0][0]).toContain("/store/products/prod_1/reviews")
  })
})
