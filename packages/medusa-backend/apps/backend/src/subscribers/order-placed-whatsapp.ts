import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../utils/whatsapp"

export default async function orderPlacedWhatsApp({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(event.data.id, {
    relations: ["shipping_address"],
    // "total" must be in select or Medusa never computes order totals
    // (order.total stays undefined, see order-summary decoration logic
    // in @medusajs/order's shouldIncludeTotals). Passing `select` makes it
    // an explicit whitelist, so display_id must be listed too or it
    // silently comes back undefined even though the column exists.
    select: ["total", "display_id"],
  })
  if (!order) return

  const phone = (order as any).shipping_address?.phone
  if (!phone) return

  const name = (order as any).shipping_address?.first_name ?? "Cliente"
  const total = (Number(order.total) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })

  await sendWhatsApp(
    phone,
    `✅ Olá ${name}! Seu pedido *#${order.display_id}* foi recebido.\n\n` +
    `💰 Total: *${total}*\n` +
    `Aguarde a confirmação do pagamento.\n\n` +
    `🛍️ _Mercado Preto — Poder na raiz, riqueza na nossa mão_`
  )
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
