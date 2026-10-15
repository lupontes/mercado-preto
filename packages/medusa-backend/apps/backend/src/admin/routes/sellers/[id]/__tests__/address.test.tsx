// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { sdk } from "../../../../lib/sdk"
import SellerDetailPage from "../page"

vi.mock("../../../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn() } } }))

const seller = {
  id: "seller_1", name: "Loja Oficial", ownerName: "Maria", email: "a@b.com", phone: "71999999999",
  cpfCnpj: "12345678900", bio: null, location: null, category: null, status: "pending", rejectionReason: null,
  addressPostalCode: null, addressStreet: null, addressNumber: null, addressComplement: null,
  addressDistrict: null, addressCity: null, addressState: null,
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sellers/seller_1"]}>
        <Routes><Route path="/sellers/:id" element={<SellerDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("SellerDetailPage — shipping address", () => {
  beforeEach(() => vi.mocked(sdk.client.fetch).mockReset())

  it("warns when the shipping address is incomplete", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller })
    renderDetail()
    expect(await screen.findByText(/Endereço de envio incompleto/)).toBeInTheDocument()
  })

  it("saves the address through PUT /admin/sellers/:id", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller })
    const user = userEvent.setup()
    renderDetail()
    await user.type(await screen.findByLabelText("CEP"), "44300000")
    await user.type(screen.getByLabelText("Rua"), "Rua Sete de Setembro")
    await user.type(screen.getByLabelText("Número"), "10")
    await user.type(screen.getByLabelText("Bairro"), "Centro Histórico")
    await user.type(screen.getByLabelText("Cidade"), "Cachoeira")
    await user.type(screen.getByLabelText("UF"), "BA")
    await user.click(screen.getByRole("button", { name: "Salvar endereço" }))
    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1", {
        method: "PUT",
        body: expect.objectContaining({ addressPostalCode: "44300000", addressCity: "Cachoeira", addressState: "BA" }),
      })
    )
  })
})
