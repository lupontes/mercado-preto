import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../utils/whatsapp"

export default async function orderCompletedWhatsApp({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(event.data.id, { relations: ["customer"] })
  if (!order) return

  const phone = (order as any).customer?.phone
  if (!phone) return

  const name = (order as any).customer?.first_name || "Cliente"

  await sendWhatsApp(
    phone,
    `🎉 Olá ${name}! Seu pedido *#${order.display_id}* foi entregue!\n\n` +
    `Esperamos que tenha adorado os produtos. Você está fortalecendo o artesanato afrobrasileiro! 🙏🏿\n\n` +
    `Avalie sua experiência no nosso site.\n\n` +
    `🛍️ _Mercado Preto — Mulheres de Axé do Brasil_`
  )
}

export const config: SubscriberConfig = {
  event: "order.completed",
}
