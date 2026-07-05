// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import NovoProdutoPage from "../page"
import * as sellerApi from "@/lib/seller-api"
import * as api from "@/lib/api"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("@/lib/seller-store", () => ({
  useSellerStore: () => ({ token: "test-token" }),
}))

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, price = "79,90") {
  await user.type(screen.getByLabelText(/Título do produto/), "Colar Contas de Vidro")
  await user.type(screen.getByLabelText(/Preço/), price)
}

describe("NovoProdutoPage", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    push.mockClear()
  })

  it("shows a validation error and does not call the API when price is invalid", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })
    const createSellerProduct = vi.spyOn(sellerApi, "createSellerProduct")
    const user = userEvent.setup()

    render(<NovoProdutoPage />)
    await user.type(screen.getByLabelText(/Título do produto/), "Colar Contas de Vidro")
    await user.type(screen.getByLabelText(/Preço/), "0")
    await user.click(screen.getByRole("button", { name: "Criar produto" }))

    expect(await screen.findByText("Preço inválido")).toBeInTheDocument()
    expect(createSellerProduct).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it("converts the price to cents and submits the product, then navigates to the list", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })
    const createSellerProduct = vi.spyOn(sellerApi, "createSellerProduct").mockResolvedValue({ product: { id: "prod_1" } })
    const user = userEvent.setup()

    render(<NovoProdutoPage />)
    await fillRequiredFields(user)
    await user.click(screen.getByRole("button", { name: "Criar produto" }))

    await waitFor(() => expect(createSellerProduct).toHaveBeenCalled())
    expect(createSellerProduct).toHaveBeenCalledWith("test-token", expect.objectContaining({
      title: "Colar Contas de Vidro",
      variants: [expect.objectContaining({
        prices: [{ amount: 7990, currency_code: "brl" }],
      })],
    }))
    expect(push).toHaveBeenCalledWith("/painel/produtos")
  })

  it("includes the selected category id in the submitted product", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({
      product_categories: [{ id: "pcat_1", name: "Moda Africana", handle: "moda-africana" }],
      count: 1,
    })
    const createSellerProduct = vi.spyOn(sellerApi, "createSellerProduct").mockResolvedValue({ product: { id: "prod_1" } })
    const user = userEvent.setup()

    render(<NovoProdutoPage />)
    await fillRequiredFields(user)
    await screen.findByRole("option", { name: "Moda Africana" })
    await user.selectOptions(screen.getByLabelText("Categoria"), "pcat_1")
    await user.click(screen.getByRole("button", { name: "Criar produto" }))

    await waitFor(() => expect(createSellerProduct).toHaveBeenCalled())
    expect(createSellerProduct).toHaveBeenCalledWith("test-token", expect.objectContaining({
      category_id: "pcat_1",
    }))
  })

  it("shows the backend error message and does not navigate when the API call fails", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })
    vi.spyOn(sellerApi, "createSellerProduct").mockRejectedValue(new Error("Dados inválidos"))
    const user = userEvent.setup()

    render(<NovoProdutoPage />)
    await fillRequiredFields(user)
    await user.click(screen.getByRole("button", { name: "Criar produto" }))

    expect(await screen.findByText("Dados inválidos")).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
