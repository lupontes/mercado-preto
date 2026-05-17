import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../utils/whatsapp"

export default async function orderShippedWhatsApp({
  event,
  container,
}: SubscriberArgs<{ id: string; tracking_number?: string }>) {
  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(event.data.id, { relations: ["customer"] })
  if (!order) return

  const phone = (order as any).customer?.phone
  if (!phone) return

  const name = (order as any).customer?.first_name || "Cliente"
  const tracking = event.data.tracking_number

  await sendWhatsApp(
    phone,
    `📦 Olá ${name}! Seu pedido *#${order.display_id}* foi enviado!\n\n` +
    (tracking ? `🔍 Código de rastreamento: *${tracking}*\n\n` : "") +
    `Acompanhe pelo site dos Correios ou da transportadora.\n\n` +
    `🛍️ _Mercado Preto_`
  )
}

export const config: SubscriberConfig = {
  event: "order.shipment_created",
}
