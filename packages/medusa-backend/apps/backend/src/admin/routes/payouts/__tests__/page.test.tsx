// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../lib/sdk"
import PayoutsPage from "../page"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const emptySellers = { sellers: [], count: 0 }
const emptyPayouts = { payouts: [], total: 0, count: 0, limit: 20, offset: 0 }

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PayoutsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("PayoutsPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches payouts filtered by pending status on first render", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyPayouts)
    })

    renderPage()

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
        query: { limit: 20, offset: 0, status: "pending" },
      })
    )
  })

  it("shows the empty state when there are no payouts", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyPayouts)
    })

    renderPage()

    expect(await screen.findByText("Nenhum repasse encontrado.")).toBeInTheDocument()
  })

  it("shows an error message when the fetch fails", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.reject(new Error("network error"))
    })

    renderPage()

    expect(
      await screen.findByText("Não foi possível carregar os repasses. Tente novamente.")
    ).toBeInTheDocument()
  })

  it("renders a row per payout with seller name, amount, period, and status", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve({
        payouts: [
          {
            id: "payout_1",
            sellerId: "seller_1",
            sellerName: "Mulheres de Axé do Brasil",
            amount: 8200,
            periodStart: "2026-07-01T00:00:00.000Z",
            periodEnd: "2026-07-06T00:00:00.000Z",
            status: "pending",
            processedAt: null,
            notes: null,
            created_at: "2026-07-06T00:00:00.000Z",
          },
        ],
        total: 8200,
        count: 1,
        limit: 20,
        offset: 0,
      })
    })

    renderPage()

    expect(await screen.findByText("Mulheres de Axé do Brasil")).toBeInTheDocument()
    const table = screen.getByRole("table")
    expect(within(table).getByText("R$ 82,00")).toBeInTheDocument()
    expect(within(table).getByText("Pendente")).toBeInTheDocument()
  })

  it("opens the create payout modal when the button is clicked", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyPayouts)
    })
    const user = userEvent.setup()

    renderPage()
    await screen.findByText("Nenhum repasse encontrado.")
    await user.click(screen.getByRole("button", { name: "+ Novo repasse" }))

    expect(await screen.findByRole("button", { name: "Criar repasse" })).toBeInTheDocument()
  })
})
