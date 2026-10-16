// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import NovoProdutoPage from "../novo/page"
import EditarProdutoPage from "../[id]/page"
import * as sellerApi from "@/lib/seller-api"
import * as api from "@/lib/api"

const push = vi.fn()
const router = { push, replace: vi.fn() }

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => ({ id: "prod_1" }),
}))

const categories = {
  product_categories: [
    { id: "cat-1", name: "BRINCOS", handle: "brincos" },
    { id: "cat-2", name: "DECORAÇÃO", handle: "decoracao" },
  ],
  count: 2,
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Título do produto/), "Cesto de palha")
  await user.type(screen.getByLabelText(/Preço/), "79,90")
}

async function fillMeasures(user: ReturnType<typeof userEvent.setup>, m: [string, string, string, string]) {
  await user.type(screen.getByLabelText("Comprimento (cm)"), m[0])
  await user.type(screen.getByLabelText("Largura (cm)"), m[1])
  await user.type(screen.getByLabelText("Altura (cm)"), m[2])
  await user.type(screen.getByLabelText("Peso (kg)"), m[3])
}

describe("package size on the new product page", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    push.mockClear()
  })

  it("suggests a size from the chosen category", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue(categories)
    const user = userEvent.setup()
    render(<NovoProdutoPage />)
    await screen.findByRole("option", { name: "BRINCOS" })

    await user.selectOptions(screen.getByLabelText("Categoria"), "cat-1")
    expect(screen.getByRole("radio", { name: /Pequeno/ })).toBeChecked()

    await user.selectOptions(screen.getByLabelText("Categoria"), "cat-2")
    expect(screen.getByRole("radio", { name: /Volumoso/ })).toBeChecked()
  })

  it("submits Volumoso with the measures", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue(categories)
    const create = vi.spyOn(sellerApi, "createSellerProduct").mockResolvedValue({ product: { id: "p" } })
    const user = userEvent.setup()
    render(<NovoProdutoPage />)
    await screen.findByRole("option", { name: "BRINCOS" })

    await fillRequired(user)
    await user.click(screen.getByRole("radio", { name: /Volumoso/ }))
    await fillMeasures(user, ["65", "40", "50", "1,2"])
    await user.click(screen.getByRole("button", { name: "Criar produto" }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      packageSize: "bulky",
      packageDimensions: { length: 65, width: 40, height: 50, weight: 1.2 },
    }))
  })

  it("blocks Volumoso above the Correios limits", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue(categories)
    const create = vi.spyOn(sellerApi, "createSellerProduct")
    const user = userEvent.setup()
    render(<NovoProdutoPage />)
    await screen.findByRole("option", { name: "BRINCOS" })

    await fillRequired(user)
    await user.click(screen.getByRole("radio", { name: /Volumoso/ }))
    await fillMeasures(user, ["120", "35", "115", "1,8"])
    await user.click(screen.getByRole("button", { name: "Criar produto" }))

    expect(await screen.findByText("Medidas acima do limite dos Correios.")).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it("blocks Volumoso without measures", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue(categories)
    const create = vi.spyOn(sellerApi, "createSellerProduct")
    const user = userEvent.setup()
    render(<NovoProdutoPage />)
    await screen.findByRole("option", { name: "BRINCOS" })

    await fillRequired(user)
    await user.click(screen.getByRole("radio", { name: /Volumoso/ }))
    await user.click(screen.getByRole("button", { name: "Criar produto" }))

    expect(await screen.findByText("Informe comprimento, largura, altura e peso da caixa.")).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })
})

describe("package size on the edit product page", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    push.mockClear()
  })

  const product = {
    id: "prod_1",
    title: "Cesto",
    status: "published",
    categories: [],
    variants: [{ id: "variant_1", prices: [{ amount: 5000, currency_code: "brl" }], weight: 1.2, length: 65, width: 40, height: 50 }],
  }

  it("pre-selects the stored size and measures, and sends them once edited", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })
    vi.spyOn(sellerApi, "getSellerProduct").mockResolvedValue({ product: { ...product, metadata: { package_size: "bulky" } } })
    const update = vi.spyOn(sellerApi, "updateSellerProduct").mockResolvedValue({ product })
    const user = userEvent.setup()
    render(<EditarProdutoPage />)

    await waitFor(() => expect(screen.getByRole("radio", { name: /Volumoso/ })).toBeChecked())
    expect(screen.getByLabelText("Comprimento (cm)")).toHaveValue("65")
    await user.clear(screen.getByLabelText("Altura (cm)"))
    await user.type(screen.getByLabelText("Altura (cm)"), "50")
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update).toHaveBeenCalledWith("prod_1", expect.objectContaining({
      packageSize: "bulky",
      packageDimensions: { length: 65, width: 40, height: 50, weight: 1.2 },
    }))
  })

  it("does not send packageSize for imported products unless the seller changes it", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })
    vi.spyOn(sellerApi, "getSellerProduct").mockResolvedValue({ product: { ...product, metadata: {} } })
    const update = vi.spyOn(sellerApi, "updateSellerProduct").mockResolvedValue({ product })
    const user = userEvent.setup()
    render(<EditarProdutoPage />)

    await waitFor(() => expect(screen.getByRole("radio", { name: /Médio/ })).toBeChecked())
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][1]).not.toHaveProperty("packageSize")

    await user.click(screen.getByRole("radio", { name: /Grande/ }))
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][1]).toHaveProperty("packageSize", "large")
  })
})
