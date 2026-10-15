// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@medusajs/admin-sdk", () => ({ defineWidgetConfig: (c: unknown) => c }))
vi.mock("../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn().mockResolvedValue({ product: {} }) } } }))

import { sdk } from "../../lib/sdk"
import Widget, { config } from "../product-package-review"

function renderWidget(data: any) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}><Widget data={data} /></QueryClientProvider>)
}

describe("ProductPackageReviewWidget", () => {
  it("sits on the product details page", () => {
    expect((config as any).zone).toBe("product.details.side.before")
  })

  it("shows the package size and lets the team approve pending measures", async () => {
    renderWidget({ id: "prod-1", metadata: { package_size: "bulky", package_review: "pending" }, variants: [{ weight: 1.2, length: 65, width: 40, height: 50 }] })
    expect(screen.getByText("Volumoso")).toBeInTheDocument()
    expect(screen.getByText("65 × 40 × 50 cm · 1.2 kg")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Medidas conferidas" }))
    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/products/prod-1/package-review", { method: "POST", body: { status: "approved" } })
  })

  it("renders nothing for products without package metadata (imported catalog)", () => {
    const { container } = renderWidget({ id: "prod-2", metadata: {}, variants: [] })
    expect(container).toBeEmptyDOMElement()
  })
})
