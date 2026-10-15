// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@medusajs/admin-sdk", () => ({ defineWidgetConfig: (config: unknown) => config }))

import OrderShippingStatusWidget, { config } from "../order-shipping-status"

describe("OrderShippingStatusWidget", () => {
  it("is placed on the order details page", () => {
    expect((config as any).zone).toBe("order.details.side.before")
  })

  it("shows the order's shipping status label", () => {
    render(<OrderShippingStatusWidget data={{ status: "pending", metadata: { shipping_status: "awaiting_shipment" } } as any} />)
    expect(screen.getByText("Status de envio")).toBeInTheDocument()
    expect(screen.getByText("Aguardando envio")).toBeInTheDocument()
  })

  it("shows Cancelado for a canceled order", () => {
    render(<OrderShippingStatusWidget data={{ status: "canceled", metadata: { shipping_status: "awaiting_shipment" } } as any} />)
    expect(screen.getByText("Cancelado")).toBeInTheDocument()
  })

  it("says the status is not recorded for orders without one", () => {
    render(<OrderShippingStatusWidget data={{ status: "pending", metadata: {} } as any} />)
    expect(screen.getByText("Não registrado")).toBeInTheDocument()
  })
})
