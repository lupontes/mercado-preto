// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import EditarProdutoPage from "../page"
import * as sellerApi from "@/lib/seller-api"
import * as api from "@/lib/api"

const push = vi.fn()
const replace = vi.fn()
// Must be a stable reference: a new object on every useRouter() call would
// change identity each render and re-trigger the data-loading effect below
// (it depends on `router`), clobbering whatever the user just typed.
const router = { push, replace }

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => ({ id: "prod_1" }),
}))

vi.mock("@/lib/seller-store", () => ({
  useSellerStore: () => ({ token: "test-token" }),
}))

const baseProduct = {
  id: "prod_1",
  title: "Turbante Afro Premium",
  description: "Turbante artesanal premium",
  status: "published",
  thumbnail: null,
  categories: [{ id: "pcat_1", name: "Moda Africana" }],
  variants: [{ id: "variant_1", prices: [{ amount: 12990, currency_code: "brl" }] }],
}

describe("EditarProdutoPage", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    push.mockClear()
    replace.mockClear()
  })

  it("pre-fills the form with the loaded product's title, price and category", async () => {
    vi.spyOn(sellerApi, "getSellerProduct").mockResolvedValue({ product: baseProduct })
    vi.spyOn(api, "listCategories").mockResolvedValue({
      product_categories: [{ id: "pcat_1", name: "Moda Africana", handle: "moda-africana" }],
      count: 1,
    })

    render(<EditarProdutoPage />)

    expect(await screen.findByDisplayValue("Turbante Afro Premium")).toBeInTheDocument()
    expect(screen.getByDisplayValue("129,9")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("Categoria")).toHaveValue("pcat_1"))
  })

  it("redirects to the product list when the product can't be loaded", async () => {
    vi.spyOn(sellerApi, "getSellerProduct").mockRejectedValue(new Error("Produto não encontrado nesta loja"))
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })

    render(<EditarProdutoPage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/painel/produtos"))
  })

  it("submits the new price for the loaded variant and navigates back to the list", async () => {
    vi.spyOn(sellerApi, "getSellerProduct").mockResolvedValue({ product: baseProduct })
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })
    const updateSellerProduct = vi.spyOn(sellerApi, "updateSellerProduct").mockResolvedValue({ product: baseProduct })
    const user = userEvent.setup()

    render(<EditarProdutoPage />)
    const priceInput = await screen.findByDisplayValue("129,9")
    await user.clear(priceInput)
    await user.type(priceInput, "149,00")
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))

    await waitFor(() => expect(updateSellerProduct).toHaveBeenCalled())
    expect(updateSellerProduct).toHaveBeenCalledWith("test-token", "prod_1", expect.objectContaining({
      variants: [{ id: "variant_1", prices: [{ amount: 14900, currency_code: "brl" }] }],
    }))
    expect(push).toHaveBeenCalledWith("/painel/produtos")
  })

  it("shows a validation error and does not call the API when price is zero", async () => {
    vi.spyOn(sellerApi, "getSellerProduct").mockResolvedValue({ product: baseProduct })
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })
    const updateSellerProduct = vi.spyOn(sellerApi, "updateSellerProduct")
    const user = userEvent.setup()

    render(<EditarProdutoPage />)
    const priceInput = await screen.findByDisplayValue("129,9")
    await user.clear(priceInput)
    await user.type(priceInput, "0")
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))

    expect(await screen.findByText("Preço inválido")).toBeInTheDocument()
    expect(updateSellerProduct).not.toHaveBeenCalled()
  })
})
