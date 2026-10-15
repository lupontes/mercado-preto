import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import type { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { SHIPPING_STATUS_LABELS, type ShippingStatus } from "../../utils/shipping-status"

type BadgeColor = "orange" | "blue" | "green" | "red" | "grey"

const COLORS: Record<ShippingStatus, BadgeColor> = {
  awaiting_shipment: "orange",
  shipped: "blue",
  delivered: "green",
}

function badgeFor(order: AdminOrder): { label: string; color: BadgeColor } {
  if (order.status === "canceled") return { label: "Cancelado", color: "red" }
  const status = order.metadata?.shipping_status as ShippingStatus | undefined
  if (!status) return { label: "Não registrado", color: "grey" }
  return { label: SHIPPING_STATUS_LABELS[status] ?? status, color: COLORS[status] ?? "grey" }
}

// Shows the marketplace shipping status, which lives in order metadata rather
// than in Medusa's native fulfillment status (see utils/shipping-status.ts).
const OrderShippingStatusWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { label, color } = badgeFor(data)
  return (
    <Container className="flex items-center justify-between px-6 py-4">
      <Heading level="h2">Status de envio</Heading>
      {label === "Não registrado" ? (
        <Text size="small" className="text-ui-fg-subtle">{label}</Text>
      ) : (
        <StatusBadge color={color}>{label}</StatusBadge>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderShippingStatusWidget
