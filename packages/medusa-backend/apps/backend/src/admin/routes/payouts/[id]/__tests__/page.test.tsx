// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../../lib/sdk"
import PayoutDetailPage from "../page"

vi.mock("../../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const basePayout = {
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
}

const baseSeller = {
  id: "seller_1",
  name: "Mulheres de Axé do Brasil",
  bankName: "Banco do Brasil",
  bankAgency: "1234",
  bankAccount: "56789-0",
  bankAccountType: "checking",
  pixKey: "contato@mercadopreto.com.br",
  pixKeyType: "email",
}

function renderDetail(initialPath = "/payouts/payout_1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/payouts/:id" element={<PayoutDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("PayoutDetailPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("shows the seller's banking data and linked commissions for a pending payout", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      payout: basePayout,
      seller: baseSeller,
      commissions: [
        {
          id: "comm_1",
          orderId: "order_1",
          grossAmount: 10000,
          commissionAmount: 1500,
          sellerPayout: 8200,
          status: "pending",
          created_at: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    renderDetail()

    expect(await screen.findByText("Banco do Brasil")).toBeInTheDocument()
    expect(screen.getByText("contato@mercadopreto.com.br")).toBeInTheDocument()
    expect(screen.getByText("order_1")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Processar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument()
  })

  it("hides action buttons for a completed payout", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      payout: { ...basePayout, status: "completed", processedAt: "2026-07-07T00:00:00.000Z" },
      seller: baseSeller,
      commissions: [],
    })

    renderDetail()

    await screen.findByText("Banco do Brasil")
    expect(screen.queryByRole("button", { name: "Processar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument()
  })

  it("calls the process mutation when confirmed", async () => {
    vi.mocked(sdk.client.fetch)
      .mockResolvedValueOnce({ payout: basePayout, seller: baseSeller, commissions: [] })
      .mockResolvedValueOnce({ payout: { ...basePayout, status: "completed" } })
      .mockResolvedValue({ payout: { ...basePayout, status: "completed" }, seller: baseSeller, commissions: [] })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Processar" }))
    await user.click(await screen.findByRole("button", { name: "Já fiz a transferência" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/payout_1/process", { method: "POST" })
    )
  })

  it("calls the cancel mutation when confirmed", async () => {
    vi.mocked(sdk.client.fetch)
      .mockResolvedValueOnce({ payout: basePayout, seller: baseSeller, commissions: [] })
      .mockResolvedValueOnce({ payout: { ...basePayout, status: "cancelled" } })
      .mockResolvedValue({ payout: { ...basePayout, status: "cancelled" }, seller: baseSeller, commissions: [] })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Cancelar" }))
    await user.click(await screen.findByRole("button", { name: "Confirmar cancelamento" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/payout_1/cancel", { method: "POST" })
    )
  })
})
