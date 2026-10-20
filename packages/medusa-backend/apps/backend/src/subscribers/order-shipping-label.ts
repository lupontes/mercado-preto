import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../modules/seller"
import { labelsEnabled, purchaseShippingLabel } from "../utils/shipping-label"
import { getLabelClient } from "../utils/melhor-envio-labels"
import { getShippingCalculator } from "../utils/melhor-envio"
import { alertTeamLabelFailed, notifySellerLabelReady } from "../utils/shipping-label-notify"

export default async function orderShippingLabel({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderId = event.data.id

  // A subscriber that throws can take the event bus down with it, and the
  // failure is already persisted on the order by purchaseShippingLabel.
  try {
    if (!labelsEnabled()) return

    const orderService: any = container.resolve(Modules.ORDER)
    // "metadata"/"display_id" must be in select or Medusa leaves them out.
    const order = await orderService.retrieveOrder(orderId, { select: ["metadata", "display_id"] })
    const metadata = order?.metadata ?? {}

    if (metadata.platform_label !== true || !metadata.shipping_service_id) return
    // A redelivered event must not buy or announce the label twice.
    if (metadata.shipping_label?.status === "generated") return

    const labels = getLabelClient()
    const calculator = getShippingCalculator()
    if (!labels || !calculator) {
      logger.warn(`[order-shipping-label] Melhor Envio not configured; skipping label for order ${orderId}`)
      return
    }

    const sellerService: any = container.resolve(SELLER_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const state = await purchaseShippingLabel(
      { orderService, sellerService, labels, calculator, query },
      orderId
    )

    const orderRef = { id: orderId, displayId: order.display_id }
    if (state.status === "generated") {
      const seller = await sellerService.retrieveSeller(metadata.seller_id)
      await notifySellerLabelReady(seller, orderRef, state)
    } else if (state.status === "failed") {
      await alertTeamLabelFailed(orderRef, state)
    }
  } catch (err) {
    logger.error(`[order-shipping-label] order ${orderId}: ${(err as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "mercadopago.order_approved",
}
