// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../lib/sdk"
import { CreatePayoutModal } from "../create-payout-modal"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CreatePayoutModal open={true} onOpenChange={() => {}} />
    </QueryClientProvider>
  )
}

describe("CreatePayoutModal", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("suggests the period and shows the calculated amount after selecting a seller", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") {
        return Promise.resolve({ sellers: [{ id: "seller_1", name: "Loja Teste" }], count: 1 })
      }
      return Promise.resolve({
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-06T00:00:00.000Z",
        amount: 8200,
        commissionCount: 2,
      })
    })
    const user = userEvent.setup()

    renderModal()
    await user.click(await screen.findByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Loja Teste" }))

    expect(await screen.findByText(/R\$ 82,00/)).toBeInTheDocument()
    expect(screen.getByLabelText("Início do período")).toHaveValue("2026-07-01")
    expect(screen.getByLabelText("Fim do período")).toHaveValue("2026-07-06")
  })

  it("disables the create button when the calculated amount is zero", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") {
        return Promise.resolve({ sellers: [{ id: "seller_1", name: "Loja Teste" }], count: 1 })
      }
      return Promise.resolve({
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-06T00:00:00.000Z",
        amount: 0,
        commissionCount: 0,
      })
    })
    const user = userEvent.setup()

    renderModal()
    await user.click(await screen.findByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Loja Teste" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Criar repasse" })).toBeDisabled())
  })

  it("submits with the selected seller and period on confirm", async () => {
    vi.mocked(sdk.client.fetch).mockImplementation((path: string) => {
      if (path === "/admin/sellers") {
        return Promise.resolve({ sellers: [{ id: "seller_1", name: "Loja Teste" }], count: 1 })
      }
      if (path === "/admin/payouts/preview") {
        return Promise.resolve({
          periodStart: "2026-07-01T00:00:00.000Z",
          periodEnd: "2026-07-06T00:00:00.000Z",
          amount: 8200,
          commissionCount: 2,
        })
      }
      return Promise.resolve({ payout: { id: "payout_1" } })
    })
    const user = userEvent.setup()

    renderModal()
    await user.click(await screen.findByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Loja Teste" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Criar repasse" })).toBeEnabled())

    await user.click(screen.getByRole("button", { name: "Criar repasse" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
        method: "POST",
        body: {
          sellerId: "seller_1",
          periodStart: "2026-07-01T00:00:00.000Z",
          periodEnd: "2026-07-06T00:00:00.000Z",
        },
      })
    )
  })
})
