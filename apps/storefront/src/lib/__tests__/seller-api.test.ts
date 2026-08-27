import { afterEach, describe, expect, it, vi } from "vitest"
import { getSellerProduct, sellerLogin, sellerLogout, setSellerPassword } from "../seller-api"

describe("getSellerProduct", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches a single product by id from the detail endpoint, with the session cookie included", async () => {
    const product = { id: "prod_1", title: "Produto", categories: [{ id: "pcat_1", name: "Categoria" }] }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ product }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await getSellerProduct("prod_1")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/seller/products/prod_1"),
      expect.objectContaining({ credentials: "include" })
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

    await expect(getSellerProduct("missing")).rejects.toThrow("Produto não encontrado nesta loja")
  })
})

describe("sellerLogin", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the publishable API key header and includes credentials so the session cookie is stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ seller: { id: "seller_1" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await sellerLogin("joao@teste.com", "secret")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/login"),
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "x-publishable-api-key": expect.any(String) }),
      })
    )
    expect(result).toEqual({ seller: { id: "seller_1" } })
  })
})

describe("sellerLogout", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts to the logout endpoint with credentials so the server can clear the cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)

    await sellerLogout()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" })
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
