import { applyTracking } from "../shipping-label-tracking"
import type { ShippingLabelState } from "../shipping-label"
import type { ShippingStatus } from "../shipping-status"
import type { TrackingInfo } from "../melhor-envio-labels"

const label = (over: Partial<ShippingLabelState> = {}): ShippingLabelState => ({
  status: "generated", meOrderIds: ["me-1"], price: 1500, trackingCode: null,
  generatedAt: "2026-10-01T00:00:00.000Z", postBy: null, reminderSentAt: null,
  error: null, paid: true, pendingSince: null, ...over,
})
const info = (status: string | null | undefined, over: Partial<TrackingInfo> = {}): TrackingInfo =>
  ({ status: status as string, trackingCode: "BR123", postedAt: null, deliveredAt: null, ...over })
const current = (shippingStatus: ShippingStatus = "awaiting_shipment", orderStatus = "pending", l = label()) =>
  ({ shippingStatus, orderStatus, label: l })

describe("applyTracking", () => {
  it("moves posted to shipped, stores the tracking code and flags the shipment", () => {
    const result = applyTracking(current(), info("posted"))
    expect(result.shippingStatus).toBe("shipped")
    expect(result.label.trackingCode).toBe("BR123")
    expect(result.shipmentCreated).toBe(true)
  })

  it("flags the shipment only the first time", () => {
    const result = applyTracking(current("shipped"), info("posted"))
    expect(result.shippingStatus).toBe("shipped")
    expect(result.shipmentCreated).toBe(false)
  })

  it("keeps the existing tracking code when the update has none", () => {
    const result = applyTracking(current("awaiting_shipment", "pending", label({ trackingCode: "OLD" })), info("posted", { trackingCode: null }))
    expect(result.label.trackingCode).toBe("OLD")
  })

  it("moves delivered from shipped without flagging a shipment", () => {
    const result = applyTracking(current("shipped"), info("delivered"))
    expect(result.shippingStatus).toBe("delivered")
    expect(result.shipmentCreated).toBe(false)
  })

  it("flags the shipment when delivered arrives before posted", () => {
    const result = applyTracking(current("awaiting_shipment"), info("delivered"))
    expect(result.shippingStatus).toBe("delivered")
    expect(result.shipmentCreated).toBe(true)
    expect(result.label.trackingCode).toBe("BR123")
  })

  it("never moves delivered back to shipped", () => {
    const result = applyTracking(current("delivered"), info("posted"))
    expect(result.shippingStatus).toBe("delivered")
    expect(result.shipmentCreated).toBe(false)
  })

  it.each(["canceled", "cancelled", " Canceled "])("marks the label canceled for %p and keeps the shipping status", (status) => {
    const result = applyTracking(current("awaiting_shipment"), info(status))
    expect(result.label.status).toBe("canceled")
    expect(result.shippingStatus).toBe("awaiting_shipment")
    expect(result.shipmentCreated).toBe(false)
  })

  it("matches statuses case-insensitively and trimmed", () => {
    expect(applyTracking(current(), info("  POSTED ")).shippingStatus).toBe("shipped")
  })

  it("does not change a canceled order", () => {
    const input = current("awaiting_shipment", "canceled")
    const result = applyTracking(input, info("posted"))
    expect(result).toEqual({ shippingStatus: "awaiting_shipment", label: input.label, shipmentCreated: false })
  })

  it.each(["released", "", null, undefined])("does not change anything for status %p", (status) => {
    const input = current()
    const result = applyTracking(input, info(status))
    expect(result).toEqual({ shippingStatus: "awaiting_shipment", label: input.label, shipmentCreated: false })
  })

  it("does not mutate its inputs", () => {
    const input = current()
    const snapshot = JSON.parse(JSON.stringify(input))
    applyTracking(input, info("posted"))
    expect(input).toEqual(snapshot)
  })
})
