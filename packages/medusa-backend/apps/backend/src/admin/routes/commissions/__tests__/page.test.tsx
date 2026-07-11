// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../lib/sdk"
import CommissionsPage from "../page"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const emptySellers = { sellers: [], count: 0 }
const emptyCommissions = {
  commissions: [],
  totals: { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 },
  count: 0,
  limit: 20,
  offset: 0,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommissionsPage />
    </QueryClientProvider>
  )
}

describe("CommissionsPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches commissions with pagination but no status/seller filter by default", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyCommissions)
    })

    renderPage()

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", {
        query: { limit: 20, offset: 0 },
      })
    )
  })

  it("shows the totals cards with formatted BRL values", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve({
        ...emptyCommissions,
        totals: { grossAmount: 100000, commissionAmount: 15000, sellerPayout: 85000 },
      })
    })

    renderPage()

    expect(await screen.findByText("R$ 1.000,00")).toBeInTheDocument()
    expect(screen.getByText("R$ 150,00")).toBeInTheDocument()
    expect(screen.getByText("R$ 850,00")).toBeInTheDocument()
  })

  it("shows an error message when the fetch fails", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.reject(new Error("network error"))
    })

    renderPage()

    expect(
      await screen.findByText("Não foi possível carregar as comissões. Tente novamente.")
    ).toBeInTheDocument()
  })

  it("shows the empty state when there are no commissions", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyCommissions)
    })

    renderPage()

    expect(await screen.findByText("Nenhuma comissão encontrada.")).toBeInTheDocument()
  })

  it("renders a row per commission with seller name, amounts, and status", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve({
        commissions: [
          {
            id: "comm_1",
            orderId: "order_1",
            sellerId: "seller_1",
            sellerName: "Mulheres de Axé do Brasil",
            grossAmount: 10000,
            bankingFees: 300,
            netAmount: 9700,
            commissionRate: 15,
            commissionAmount: 1455,
            sellerPayout: 8245,
            status: "pending",
            paidAt: null,
            created_at: "2026-07-01T00:00:00.000Z",
          },
        ],
        totals: { grossAmount: 10000, commissionAmount: 1455, sellerPayout: 8245 },
        count: 1,
        limit: 20,
        offset: 0,
      })
    })

    renderPage()

    expect(await screen.findByText("order_1")).toBeInTheDocument()
    expect(screen.getByText("Mulheres de Axé do Brasil")).toBeInTheDocument()
    expect(screen.getByText("Pendente")).toBeInTheDocument()
  })

  it("refetches with the selected status when the status filter changes", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") return Promise.resolve(emptySellers)
      return Promise.resolve(emptyCommissions)
    })
    const user = userEvent.setup()

    renderPage()
    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", expect.anything())
    )

    const comboboxes = screen.getAllByRole("combobox")
    await user.click(comboboxes[1])
    await user.click(await screen.findByRole("option", { name: "Pago" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", {
        query: { limit: 20, offset: 0, status: "paid" },
      })
    )
  })
})
