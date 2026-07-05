import { afterEach, describe, expect, it, vi } from "vitest"
import { getSellerProduct } from "../seller-api"

describe("getSellerProduct", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches a single product by id from the detail endpoint", async () => {
    const product = { id: "prod_1", title: "Produto", categories: [{ id: "pcat_1", name: "Categoria" }] }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ product }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await getSellerProduct("token", "prod_1")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/seller/products/prod_1"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) })
    )
    expect(result.product).toEqual(product)
  })

  it("throws when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Produto não encontrado nesta loja" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getSellerProduct("token", "missing")).rejects.toThrow("Produto não encontrado nesta loja")
  })
})
