// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@medusajs/admin-sdk", () => ({ defineWidgetConfig: (config: unknown) => config }))
vi.mock("@medusajs/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@medusajs/ui")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock("../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn() } } }))

import { toast } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"
import ProductModerationWidget, { config } from "../product-moderation"

const fetchMock = sdk.client.fetch as unknown as ReturnType<typeof vi.fn>

const product = {
  id: "prod_1",
  title: "Brinco",
  description: "Antigo",
  thumbnail: "https://x/old.png",
  // Mirrors the real detail page: no variants, so "before" values must come from the endpoint.
}

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ProductModerationWidget data={product as any} />
    </QueryClientProvider>
  )
}

const current = { title: "Brinco", description: "Antigo", thumbnail: null, categoryId: "pcat_1", price: 5000, packageSize: "small", packageDimensions: null }
const seller = { name: "Loja Axé", phone: "(11) 91234-5678" }

describe("ProductModerationWidget", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it("is placed on the product details side", () => {
    expect((config as any).zone).toBe("product.details.side.before")
  })

  it("renders nothing when there is nothing to review", async () => {
    fetchMock.mockResolvedValue({ kind: null, pendingChanges: null, current, seller })
    const { container } = renderWidget()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("approves a new product with a POST and a toast", async () => {
    fetchMock.mockImplementation((_path: string, opts?: { method?: string }) =>
      Promise.resolve(opts?.method === "POST" ? { ok: true } : { kind: "new", pendingChanges: null, current, seller })
    )
    renderWidget()

    expect(await screen.findByText("Em análise")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Aprovar e publicar" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/admin/products/prod_1/moderation", { method: "POST" })
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Produto aprovado"))
  })

  it("shows the server error in a toast when approval is refused", async () => {
    fetchMock.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === "POST"
        ? Promise.reject(Object.assign(new Error("Nada para aprovar"), { status: 409, statusText: "Conflict" }))
        : Promise.resolve({ kind: "new", pendingChanges: null, current, seller })
    )
    renderWidget()
    await userEvent.click(await screen.findByRole("button", { name: "Aprovar e publicar" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nada para aprovar"))
  })

  it("falls back to a pt-BR message when the error has none", async () => {
    fetchMock.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === "POST"
        ? Promise.reject(new Error(""))
        : Promise.resolve({ kind: "new", pendingChanges: null, current, seller })
    )
    renderWidget()
    await userEvent.click(await screen.findByRole("button", { name: "Aprovar e publicar" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Não foi possível aprovar."))
  })

  it("shows before and after for each changed field", async () => {
    fetchMock.mockResolvedValue({
      kind: "change",
      pendingChanges: {
        title: "Brinco novo",
        variants: [{ id: "v1", prices: [{ amount: 6000, currency_code: "brl" }] }],
        packageSize: "large",
        submittedAt: "2026-10-21T15:00:00.000Z",
      },
      current,
      seller,
    })
    renderWidget()

    expect(await screen.findByText("Alteração em análise")).toBeInTheDocument()
    expect(screen.getByText(/R\$\s50,00\s→\sR\$\s60,00/)).toBeInTheDocument()
    expect(screen.getByText("Brinco → Brinco novo")).toBeInTheDocument()
    expect(screen.getByText("Pequeno → Grande")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aprovar alteração" })).toBeInTheDocument()
  })

  it("links to WhatsApp adding the 55 prefix", async () => {
    fetchMock.mockResolvedValue({ kind: "new", pendingChanges: null, current, seller })
    renderWidget()
    const link = await screen.findByRole("link", { name: "Falar com a vendedora no WhatsApp" })
    expect(link).toHaveAttribute("href", "https://wa.me/5511912345678")
    expect(screen.getByText("Para trocar a foto, use Mídia e marque a nova como miniatura.")).toBeInTheDocument()
  })

  it("does not duplicate the 55 prefix", async () => {
    fetchMock.mockResolvedValue({ kind: "new", pendingChanges: null, current, seller: { name: "L", phone: "+55 (11) 91234-5678" } })
    renderWidget()
    const link = await screen.findByRole("link", { name: "Falar com a vendedora no WhatsApp" })
    expect(link).toHaveAttribute("href", "https://wa.me/5511912345678")
  })
})
