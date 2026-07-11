// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../lib/sdk"
import SellersPage from "../page"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SellersPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("SellersPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches sellers filtered by pending status on first render", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })

    renderPage()

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers", {
        query: { status: "pending" },
      })
    )
  })

  it("shows the pending empty state when there are no pending sellers", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })

    renderPage()

    expect(await screen.findByText("Nenhum vendedor pendente 🎉")).toBeInTheDocument()
  })

  it("shows an error message instead of the empty state when the fetch fails", async () => {
    vi.mocked(sdk.client.fetch).mockRejectedValue(new Error("network error"))

    renderPage()

    expect(
      await screen.findByText("Não foi possível carregar os vendedores. Tente novamente.")
    ).toBeInTheDocument()
    expect(screen.queryByText("Nenhum vendedor pendente 🎉")).not.toBeInTheDocument()
  })

  it("renders a row per seller with name, email, and status", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      sellers: [
        {
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
        },
      ],
      count: 1,
    })

    renderPage()

    expect(await screen.findByText("Mulheres de Axé do Brasil")).toBeInTheDocument()
    expect(screen.getByText("contato@mercadopreto.com.br")).toBeInTheDocument()
    expect(screen.getByText("Pendente")).toBeInTheDocument()
  })

  it("refetches with the new status when the filter changes", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })
    const user = userEvent.setup()

    renderPage()
    await waitFor(() => expect(sdk.client.fetch).toHaveBeenCalled())

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Ativos" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers", {
        query: { status: "active" },
      })
    )
  })
})
