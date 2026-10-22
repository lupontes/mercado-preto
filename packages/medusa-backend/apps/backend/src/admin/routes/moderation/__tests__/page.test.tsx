// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { sdk } from "../../../lib/sdk"
import ModerationPage from "../page"

vi.mock("@medusajs/admin-sdk", () => ({ defineRouteConfig: (config: unknown) => config }))
vi.mock("../../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn() } } }))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ModerationPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("ModerationPage", () => {
  beforeEach(() => vi.mocked(sdk.client.fetch).mockReset())

  it("lists the products awaiting review", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      items: [
        { id: "prod_1", title: "Brinco", thumbnail: "https://x/a.png", sellerName: "Loja Axé", kind: "new", submittedAt: "2026-10-20T15:00:00.000Z" },
        { id: "prod_2", title: "Colar", thumbnail: null, sellerName: "Loja Ori", kind: "change", submittedAt: "2026-10-21T15:00:00.000Z" },
      ],
    })
    renderPage()

    expect(await screen.findByText("Brinco")).toBeInTheDocument()
    expect(screen.getByText("Loja Axé")).toBeInTheDocument()
    expect(screen.getByText("Novo")).toBeInTheDocument()
    expect(screen.getByText("Alteração")).toBeInTheDocument()
    expect(screen.getByText("20/10/2026")).toBeInTheDocument()
    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/moderation/products")
  })

  it("shows the empty text when the queue is empty", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ items: [] })
    renderPage()
    expect(await screen.findByText("Nenhum produto aguardando análise.")).toBeInTheDocument()
  })
})
