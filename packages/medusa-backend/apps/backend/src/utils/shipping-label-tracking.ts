import type { TrackingInfo } from "./melhor-envio-labels"
import type { ShippingLabelState } from "./shipping-label"
import type { ShippingStatus } from "./shipping-status"

export type TrackingCurrent = {
  shippingStatus: ShippingStatus
  orderStatus: string
  label: ShippingLabelState
}

export type TrackingResult = {
  shippingStatus: ShippingStatus
  label: ShippingLabelState
  /** True when this update is the first sign the parcel left, so the order shipment must be created. */
  shipmentCreated: boolean
}

/**
 * Pure: turns a Melhor Envio tracking update into the order's next shipping state.
 * Callers (polling job, webhook) persist the result and act on `shipmentCreated`.
 */
export function applyTracking(current: TrackingCurrent, info: TrackingInfo): TrackingResult {
  const unchanged: TrackingResult = { shippingStatus: current.shippingStatus, label: current.label, shipmentCreated: false }
  // A canceled order must not be revived by late carrier events.
  if (current.orderStatus === "canceled") return unchanged

  const status = (info.status ?? "").trim().toLowerCase()
  const trackingCode = info.trackingCode ?? current.label.trackingCode
  const alreadyShipped = current.shippingStatus === "shipped" || current.shippingStatus === "delivered"

  switch (status) {
    case "posted":
      // Delivered is final: a stale "posted" must never move it back.
      if (current.shippingStatus === "delivered") return unchanged
      return {
        shippingStatus: "shipped",
        label: { ...current.label, trackingCode },
        shipmentCreated: !alreadyShipped,
      }
    case "delivered":
      return {
        shippingStatus: "delivered",
        label: { ...current.label, trackingCode },
        shipmentCreated: !alreadyShipped,
      }
    case "canceled":
    case "cancelled":
      return { ...unchanged, label: { ...current.label, status: "canceled" } }
    default:
      return unchanged
  }
}
