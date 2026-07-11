// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../../lib/sdk"
import SellerDetailPage from "../page"

vi.mock("../../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const pendingSeller = {
  id: "seller_1",
  name: "Mulheres de Axé do Brasil",
  ownerName: "Maria",
  email: "contato@mercadopreto.com.br",
  phone: "71999999999",
  cpfCnpj: "12345678900",
  bio: null,
  location: null,
  category: null,
  status: "pending",
  rejectionReason: null,
}

function renderDetail(initialPath = "/sellers/seller_1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/sellers/:id" element={<SellerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("SellerDetailPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("shows Aprovar and Rejeitar for a pending seller", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: pendingSeller })

    renderDetail()

    expect(await screen.findByRole("button", { name: "Aprovar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Suspender" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reativar" })).not.toBeInTheDocument()
  })

  it("shows only Suspender for an active seller", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: { ...pendingSeller, status: "active" } })

    renderDetail()

    expect(await screen.findByRole("button", { name: "Suspender" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reativar" })).not.toBeInTheDocument()
  })

  it("shows only Reativar for a suspended seller, and shows the reason", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      seller: { ...pendingSeller, status: "suspended", rejectionReason: "Prazo de entrega não cumprido" },
    })

    renderDetail()

    expect(await screen.findByRole("button", { name: "Reativar" })).toBeInTheDocument()
    expect(screen.getByText("Prazo de entrega não cumprido")).toBeInTheDocument()
  })

  it("does not submit the reject dialog without a reason", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: pendingSeller })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Rejeitar" }))

    const confirmButton = await screen.findByRole("button", { name: "Confirmar rejeição" })
    expect(confirmButton).toBeDisabled()

    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "CNPJ inválido")
    expect(confirmButton).toBeEnabled()
  })

  it("calls the reject mutation with the typed reason on confirm", async () => {
    vi.mocked(sdk.client.fetch)
      .mockResolvedValueOnce({ seller: pendingSeller })
      .mockResolvedValueOnce({ seller: { ...pendingSeller, rejectionReason: "CNPJ inválido" } })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Rejeitar" }))
    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "CNPJ inválido")
    await user.click(screen.getByRole("button", { name: "Confirmar rejeição" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1/reject", {
        method: "POST",
        body: { reason: "CNPJ inválido" },
      })
    )
  })
})
