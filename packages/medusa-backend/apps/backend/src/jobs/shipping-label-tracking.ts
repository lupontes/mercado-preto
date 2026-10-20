import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { getLabelClient, TrackingInfo } from "../utils/melhor-envio-labels"
import { labelsEnabled, ShippingLabelState } from "../utils/shipping-label"
import { notifySellerPostingReminder } from "../utils/shipping-label-notify"
import { applyTracking } from "../utils/shipping-label-tracking"
import type { ShippingStatus } from "../utils/shipping-status"

const PAGE_SIZE = 200
const TRACKING_CHUNK_SIZE = 50

type Logger = { info: (msg: string) => void; error: (msg: string) => void }

// en-CA formats as YYYY-MM-DD, which compares as a plain string.
const saoPauloDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })

const saoPauloHour = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" })
// The job runs on UTC cron ticks, so without this the first tick of the day (01:00 BRT) would wake the seller.
const REMINDER_FROM_HOUR = 8

/**
 * Polls Melhor Envio tracking for generated labels and moves the order's shipping status.
 * Needed because a personal Melhor Envio token receives no webhooks.
 * `now` is injectable for tests; Medusa only passes the container.
 */
export default async function shippingLabelTracking(container: MedusaContainer, now: () => number = Date.now) {
  const logger = container.resolve("logger") as Logger
  const client = labelsEnabled() ? getLabelClient() : null
  if (!client) {
    logger.info("[shipping-label-tracking] etiquetas desligadas ou sem cliente, nada a fazer")
    return
  }

  const orderService: any = container.resolve(Modules.ORDER)
  const sellerService: any = container.resolve("seller")
  const eventBus: any = container.resolve(Modules.EVENT_BUS)

  const orders = await listTrackableOrders(orderService)

  // Packages of one label travel together, so the first id's tracking drives the order.
  const firstIds = [...new Set(orders.map((o) => String(o.metadata.shipping_label.meOrderIds?.[0] ?? "")).filter(Boolean))]
  const trackingById: Record<string, TrackingInfo> = {}
  for (let i = 0; i < firstIds.length; i += TRACKING_CHUNK_SIZE) {
    try {
      Object.assign(trackingById, await client.tracking(firstIds.slice(i, i + TRACKING_CHUNK_SIZE)))
    } catch (err) {
      // One failed chunk must not starve the others or the reminders.
      logger.error(`[shipping-label-tracking] falha ao consultar rastreio: ${err}`)
    }
  }

  const today = saoPauloDay.format(new Date(now()))
  const reminderAllowed = Number(saoPauloHour.format(new Date(now()))) >= REMINDER_FROM_HOUR

  for (const order of orders) {
    try {
      await processOrder({ order, info: trackingById[String(order.metadata.shipping_label.meOrderIds?.[0])], today, reminderAllowed, now, orderService, sellerService, eventBus })
    } catch (err) {
      logger.error(`[shipping-label-tracking] falha no pedido ${order.id}: ${err}`)
    }
  }
}

async function listTrackableOrders(orderService: any): Promise<any[]> {
  const found: any[] = []
  // Filtering on nested JSON is unreliable in Medusa, so filter in memory.
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page: any[] = await orderService.listOrders({}, {
      select: ["id", "status", "display_id", "metadata"], take: PAGE_SIZE, skip, order: { created_at: "ASC" },
    })
    for (const o of page) {
      const m = o.metadata ?? {}
      if (m.shipping_label?.status === "generated" && m.shipping_status !== "delivered" && o.status !== "canceled") {
        found.push({ ...o, metadata: m })
      }
    }
    if (page.length < PAGE_SIZE) break
  }
  return found
}

async function processOrder(args: {
  order: any; info: TrackingInfo | undefined; today: string; reminderAllowed: boolean; now: () => number
  orderService: any; sellerService: any; eventBus: any
}) {
  const { order, info, today, reminderAllowed, now, orderService, sellerService, eventBus } = args
  let shippingStatus: ShippingStatus = order.metadata.shipping_status ?? "awaiting_shipment"
  let label: ShippingLabelState = order.metadata.shipping_label
  let shipmentCreated = false
  let changed = false

  if (info) {
    const result = applyTracking({ shippingStatus, orderStatus: order.status, label }, info)
    changed = result.shippingStatus !== shippingStatus || result.label !== label
    shippingStatus = result.shippingStatus
    label = result.label
    shipmentCreated = result.shipmentCreated
  }

  if (shippingStatus === "awaiting_shipment" && label.status === "generated" && !label.reminderSentAt && label.postBy && reminderAllowed
    && saoPauloDay.format(new Date(label.postBy)) === today) {
    const seller = await sellerService.retrieveSeller(String(order.metadata.seller_id))
    await notifySellerPostingReminder(seller, { id: order.id, displayId: order.display_id }, label)
    label = { ...label, reminderSentAt: new Date(now()).toISOString() }
    changed = true
  }

  if (!changed) return
  // Medusa replaces metadata wholesale, so the full object goes back.
  await orderService.updateOrders(order.id, { metadata: { ...order.metadata, shipping_status: shippingStatus, shipping_label: label } })
  if (shipmentCreated) {
    await eventBus.emit({ name: "order.shipment_created", data: { id: order.id, tracking_number: label.trackingCode } })
  }
}

export const config = {
  name: "shipping-label-tracking",
  schedule: "0 */2 * * *", // every 2h, same cadence as the token refresh
}
