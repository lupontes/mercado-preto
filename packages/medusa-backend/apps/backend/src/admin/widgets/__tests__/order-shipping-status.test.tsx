// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@medusajs/admin-sdk", () => ({ defineWidgetConfig: (config: unknown) => config }))
vi.mock("../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn() } } }))

import { sdk } from "../../lib/sdk"
import OrderShippingStatusWidget, { config } from "../order-shipping-status"

const fetchMock = sdk.client.fetch as unknown as ReturnType<typeof vi.fn>

function renderWidget(data: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><OrderShippingStatusWidget data={data} /></QueryClientProvider>)
}

const label = (over: Record<string, unknown> = {}) => ({
  status: "generated", meOrderIds: ["me1"], price: 1590, paid: true, pendingSince: null,
  trackingCode: null, generatedAt: null, postBy: null, reminderSentAt: null, error: null, ...over,
})
const order = (shipping_label?: unknown, shipping_status = "awaiting_shipment") =>
  ({ id: "order_1", status: "pending", metadata: { shipping_status, ...(shipping_label ? { shipping_label } : {}) } })

describe("OrderShippingStatusWidget", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ link: "https://api/labels/tok" })
  })

  it("is placed on the order details page", () => {
    expect((config as any).zone).toBe("order.details.side.before")
  })

  it("shows the order's shipping status label", () => {
    renderWidget(order())
    expect(screen.getByText("Status de envio")).toBeInTheDocument()
    expect(screen.getByText("Aguardando envio")).toBeInTheDocument()
  })

  it("shows Cancelado for a canceled order", () => {
    renderWidget({ id: "o", status: "canceled", metadata: { shipping_status: "awaiting_shipment" } })
    expect(screen.getByText("Cancelado")).toBeInTheDocument()
  })

  it("says the status is not recorded for orders without one", () => {
    renderWidget({ id: "o", status: "pending", metadata: {} })
    expect(screen.getByText("Não registrado")).toBeInTheDocument()
  })

  it("shows a generated label with price, tracking and print link, and offers cancel only", async () => {
    renderWidget(order(label({ trackingCode: "BR123" })))
    expect(screen.getByText("Etiqueta gerada")).toBeInTheDocument()
    expect(screen.getByText(/R\$\s?15,90/)).toBeInTheDocument()
    expect(screen.getByText("BR123")).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "Abrir etiqueta" })).toHaveAttribute("href", "https://api/labels/tok")
    expect(screen.getByRole("button", { name: "Cancelar etiqueta" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Comprar etiqueta de novo" })).not.toBeInTheDocument()
  })

  it("offers buy again only for a failed label and posts to the route", async () => {
    renderWidget(order(label({ status: "failed", error: "Saldo insuficiente" })))
    expect(screen.getByText("Saldo insuficiente")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancelar etiqueta" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Comprar etiqueta de novo" }))
    expect(fetchMock).toHaveBeenCalledWith("/admin/orders/order_1/shipping-label", { method: "POST" })
  })

  it("cancels the label through DELETE", async () => {
    renderWidget(order(label()))
    await userEvent.click(screen.getByRole("button", { name: "Cancelar etiqueta" }))
    expect(fetchMock).toHaveBeenCalledWith("/admin/orders/order_1/shipping-label", { method: "DELETE" })
  })

  it("hides cancel once the order is shipped", () => {
    renderWidget(order(label(), "shipped"))
    expect(screen.queryByRole("button", { name: "Cancelar etiqueta" })).not.toBeInTheDocument()
  })

  it("flags an overdue posting deadline while awaiting shipment", () => {
    renderWidget(order(label({ postBy: "2020-01-01T00:00:00Z" })))
    expect(screen.getByText("Prazo de postagem vencido")).toBeInTheDocument()
  })

  it("does not flag a deadline in the future or an already shipped order", () => {
    const { unmount } = renderWidget(order(label({ postBy: "2999-01-01T00:00:00Z" })))
    expect(screen.queryByText("Prazo de postagem vencido")).not.toBeInTheDocument()
    unmount()
    renderWidget(order(label({ postBy: "2020-01-01T00:00:00Z" }), "shipped"))
    expect(screen.queryByText("Prazo de postagem vencido")).not.toBeInTheDocument()
  })

  it("offers buy again for a pending label stuck for over 15 minutes", () => {
    renderWidget(order(label({ status: "pending", pendingSince: new Date(Date.now() - 20 * 60_000).toISOString() })))
    expect(screen.getByRole("button", { name: "Comprar etiqueta de novo" })).toBeInTheDocument()
  })
})
