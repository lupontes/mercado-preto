import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { TrackingInfo } from "../../../utils/melhor-envio-labels"
import type { ShippingLabelState } from "../../../utils/shipping-label"
import { applyTracking } from "../../../utils/shipping-label-tracking"
import type { ShippingStatus } from "../../../utils/shipping-status"

const PAGE_SIZE = 200

// Only these events change an order; the rest are acknowledged and dropped.
const EVENT_TO_STATUS: Record<string, string> = {
  "order.posted": "posted",
  "order.delivered": "delivered",
  "order.cancelled": "canceled",
}

type WebhookBody = {
  event?: string
  data?: { id?: string; tracking?: string | null; posted_at?: string | null; delivered_at?: string | null }
}

// Melhor Envio sends the HMAC-SHA256 of the raw body, base64 encoded.
function isValidSignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header) return false
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("base64"))
  const received = Buffer.from(header)
  // timingSafeEqual throws on different lengths.
  return received.length === expected.length && crypto.timingSafeEqual(received, expected)
}

async function findOrderByLabelId(orderService: any, labelId: string): Promise<any | null> {
  // Filtering on nested JSON is unreliable in Medusa, so filter in memory.
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page: any[] = await orderService.listOrders({}, {
      select: ["id", "status", "display_id", "metadata"], take: PAGE_SIZE, skip, order: { created_at: "ASC" },
    })
    const found = page.find((o) => (o.metadata?.shipping_label?.meOrderIds ?? []).map(String).includes(labelId))
    if (found) return { ...found, metadata: found.metadata ?? {} }
    if (page.length < PAGE_SIZE) return null
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const secret = process.env.MELHOR_ENVIO_WEBHOOK_SECRET
  if (!secret) return res.status(503).json({ error: "Webhook do Melhor Envio não configurado" })

  const rawBody = (req as any).rawBody as Buffer | string | undefined
  if (!rawBody || !isValidSignature(rawBody, req.headers["x-me-signature"] as string | undefined, secret)) {
    return res.status(401).json({ error: "Assinatura inválida" })
  }

  const { event, data } = (req.body ?? {}) as WebhookBody
  const status = event ? EVENT_TO_STATUS[event] : undefined
  if (!status || !data?.id) return res.status(200).json({ received: true })

  const orderService: any = req.scope.resolve(Modules.ORDER)
  const order = await findOrderByLabelId(orderService, String(data.id))
  // 200 so Melhor Envio does not retry labels that are not ours.
  if (!order) return res.status(200).json({ received: true })

  const shippingStatus: ShippingStatus = order.metadata.shipping_status ?? "awaiting_shipment"
  const label: ShippingLabelState = order.metadata.shipping_label
  const info: TrackingInfo = {
    status,
    trackingCode: data.tracking ?? null,
    postedAt: data.posted_at ?? null,
    deliveredAt: data.delivered_at ?? null,
  }
  const result = applyTracking({ shippingStatus, orderStatus: order.status, label }, info)

  if (result.shippingStatus !== shippingStatus || result.label !== label) {
    // Medusa replaces metadata wholesale, so the full object goes back.
    await orderService.updateOrders(order.id, {
      metadata: { ...order.metadata, shipping_status: result.shippingStatus, shipping_label: result.label },
    })
    if (result.shipmentCreated) {
      const eventBus: any = req.scope.resolve(Modules.EVENT_BUS)
      await eventBus.emit({ name: "order.shipment_created", data: { id: order.id, tracking_number: result.label.trackingCode } })
    }
  }
  return res.status(200).json({ received: true })
}
