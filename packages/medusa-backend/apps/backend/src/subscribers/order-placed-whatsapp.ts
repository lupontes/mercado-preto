import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { sendWhatsApp } from "../utils/whatsapp"

type SiblingOrderLike = { id: string; display_id: number; total?: number }

// Formata "#13" (1 pedido) ou "#13, #14 e #15" (vários) para a mensagem.
function formatOrderLabel(displayIds: number[]): string {
  if (displayIds.length === 1) return `#${displayIds[0]}`
  const allButLast = displayIds.slice(0, -1).map((id) => `#${id}`)
  const last = `#${displayIds[displayIds.length - 1]}`
  return `${allButLast.join(", ")} e ${last}`
}

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
    // an explicit whitelist, so display_id/metadata must be listed too or
    // they silently come back undefined even though the columns exist.
    select: ["total", "display_id", "metadata"],
  })
  if (!order) return

  const phone = (order as any).shipping_address?.phone
  if (!phone) return

  // Um único pagamento pode ter gerado N pedidos (split multi-vendedor,
  // ver webhooks/mercadopago/route.ts). Sem isso, o comprador recebe uma
  // confirmação de WhatsApp por vendedor, cada uma com um total parcial —
  // o que parece cobrança duplicada. Consolida numa única mensagem por
  // pagamento: só o pedido de menor id entre os irmãos envia; os outros
  // saem cedo (checagem determinística, sem coordenação entre subscribers).
  let displayIds = [order.display_id as number]
  let total = Number(order.total ?? 0)

  const externalReference = (order.metadata as any)?.mercadopago_external_reference as string | undefined
  if (externalReference) {
    const siblings: SiblingOrderLike[] = (await orderService.listOrders(
      { metadata: { mercadopago_external_reference: externalReference } } as any,
      { select: ["id", "display_id", "total"] }
    )) as any
    if (siblings.length > 1) {
      const designated = [...siblings].sort((a, b) => a.id.localeCompare(b.id))[0]
      if (designated.id !== order.id) return
      displayIds = siblings.map((o) => o.display_id).sort((a, b) => a - b)
      total = siblings.reduce((sum, o) => sum + Number(o.total ?? 0), 0)
    }
  }

  const name = (order as any).shipping_address?.first_name ?? "Cliente"
  const formattedTotal = (total / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
  const possessiveAndWord = displayIds.length > 1 ? "Seus pedidos" : "Seu pedido"
  const verb = displayIds.length > 1 ? "foram recebidos" : "foi recebido"

  await sendWhatsApp(
    phone,
    `✅ Olá ${name}! ${possessiveAndWord} *${formatOrderLabel(displayIds)}* ${verb}.\n\n` +
    `💰 Total: *${formattedTotal}*\n` +
    `Aguarde a confirmação do pagamento.\n\n` +
    `🛍️ _Mercado Preto — Poder na raiz, riqueza na nossa mão_`
  )
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
