import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import type { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"
import { SHIPPING_STATUS_LABELS, type ShippingStatus } from "../../utils/shipping-status"
import type { ShippingLabelState } from "../../utils/shipping-label"

type BadgeColor = "orange" | "blue" | "green" | "red" | "grey"

const COLORS: Record<ShippingStatus, BadgeColor> = {
  awaiting_shipment: "orange",
  shipped: "blue",
  delivered: "green",
}

const LABEL_STATUS: Record<ShippingLabelState["status"], { label: string; color: BadgeColor }> = {
  pending: { label: "Etiqueta em preparação", color: "orange" },
  generated: { label: "Etiqueta gerada", color: "green" },
  failed: { label: "Falha na etiqueta", color: "red" },
  canceled: { label: "Etiqueta cancelada", color: "grey" },
}

// Mirrors the 15-minute rule enforced by the admin route.
const STALE_PENDING_MS = 15 * 60 * 1000

function badgeFor(order: AdminOrder): { label: string; color: BadgeColor } {
  if (order.status === "canceled") return { label: "Cancelado", color: "red" }
  const status = order.metadata?.shipping_status as ShippingStatus | undefined
  if (!status) return { label: "Não registrado", color: "grey" }
  return { label: SHIPPING_STATUS_LABELS[status] ?? status, color: COLORS[status] ?? "grey" }
}

const formatPrice = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

function ShippingLabelSection({ orderId, label, awaitingShipment }: { orderId: string; label: ShippingLabelState; awaitingShipment: boolean }) {
  const queryClient = useQueryClient()
  const path = `/admin/orders/${orderId}/shipping-label`

  const link = useQuery({
    queryKey: ["order-shipping-label-link", orderId],
    queryFn: () => sdk.client.fetch<{ link: string | null }>(path),
    enabled: label.status === "generated",
  })

  const onError = (err: unknown) => toast.error((err as Error)?.message ?? "Não foi possível concluir a ação")
  const onSuccess = (message: string) => () => {
    toast.success(message)
    queryClient.invalidateQueries()
  }
  const buyAgain = useMutation({
    mutationFn: () => sdk.client.fetch(path, { method: "POST" }),
    onSuccess: onSuccess("Compra da etiqueta refeita"),
    onError,
  })
  const cancel = useMutation({
    mutationFn: () => sdk.client.fetch(path, { method: "DELETE" }),
    onSuccess: onSuccess("Etiqueta cancelada"),
    onError,
  })

  const stalePending =
    label.status === "pending" &&
    !!label.pendingSince &&
    Date.now() - new Date(label.pendingSince).getTime() > STALE_PENDING_MS
  const canBuyAgain = label.status === "failed" || stalePending
  const canCancel = label.status === "generated" && awaitingShipment
  const overdue = !!label.postBy && new Date(label.postBy).getTime() < Date.now() && awaitingShipment
  const { label: statusLabel, color } = LABEL_STATUS[label.status]

  return (
    <div className="flex flex-col gap-2 border-t border-ui-border-base pt-3">
      <StatusBadge color={color}>{statusLabel}</StatusBadge>
      {label.price != null && <Text size="small">{`Frete: ${formatPrice(label.price)}`}</Text>}
      {label.trackingCode && <Text size="small">{label.trackingCode}</Text>}
      {label.status === "failed" && label.error && (
        <Text size="small" className="text-ui-fg-error">{label.error}</Text>
      )}
      {overdue && <Text size="small" className="text-ui-fg-error">Prazo de postagem vencido</Text>}
      {link.data?.link && (
        <a href={link.data.link} target="_blank" rel="noreferrer" className="text-ui-fg-interactive text-sm">
          Abrir etiqueta
        </a>
      )}
      {canBuyAgain && (
        <Button size="small" variant="secondary" isLoading={buyAgain.isPending} onClick={() => buyAgain.mutate()}>
          Comprar etiqueta de novo
        </Button>
      )}
      {canCancel && (
        <Button size="small" variant="danger" isLoading={cancel.isPending} onClick={() => cancel.mutate()}>
          Cancelar etiqueta
        </Button>
      )}
    </div>
  )
}

// Shows the marketplace shipping status, which lives in order metadata rather
// than in Medusa's native fulfillment status (see utils/shipping-status.ts),
// plus the shipping label state and the team's recovery actions.
const OrderShippingStatusWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { label, color } = badgeFor(data)
  const shippingLabel = data.metadata?.shipping_label as ShippingLabelState | undefined
  return (
    <Container className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-center justify-between">
        <Heading level="h2">Status de envio</Heading>
        {label === "Não registrado" ? (
          <Text size="small" className="text-ui-fg-subtle">{label}</Text>
        ) : (
          <StatusBadge color={color}>{label}</StatusBadge>
        )}
      </div>
      {shippingLabel && (
        <ShippingLabelSection
          orderId={data.id}
          label={shippingLabel}
          awaitingShipment={data.metadata?.shipping_status === "awaiting_shipment"}
        />
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderShippingStatusWidget
