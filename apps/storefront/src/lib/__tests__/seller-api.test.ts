import { afterEach, describe, expect, it, vi } from "vitest"
import { getSellerProduct, sellerLogin, setSellerPassword } from "../seller-api"

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

describe("sellerLogin", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the publishable API key header the backend's /store middleware requires", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "tok", seller: { id: "seller_1" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await sellerLogin("joao@teste.com", "secret")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/login"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-publishable-api-key": expect.any(String) }),
      })
    )
  })
})

describe("setSellerPassword", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the publishable API key header the backend's /store middleware requires", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Senha configurada" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await setSellerPassword("joao@teste.com", "novaSenha123")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/set-password"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-publishable-api-key": expect.any(String) }),
      })
    )
  })

  it("throws with the backend error message when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Token inválido" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(setSellerPassword("joao@teste.com", "novaSenha123")).rejects.toThrow("Token inválido")
  })
})
