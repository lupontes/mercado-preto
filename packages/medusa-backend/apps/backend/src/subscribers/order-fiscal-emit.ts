import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FISCAL_MODULE } from "../modules/fiscal"
import FiscalModuleService from "../modules/fiscal/service"
import { buildFiscalItems } from "../modules/fiscal/ncm-resolver"
import { SELLER_MODULE } from "../modules/seller"

export default async function orderFiscalEmit({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  const fiscalService: FiscalModuleService = container.resolve(FISCAL_MODULE)

  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(orderId, {
    relations: ["items", "shipping_address"],
    // "total" must be in select or Medusa never computes order totals
    // (order.total stays undefined, see order-summary decoration logic
    // in @medusajs/order's shouldIncludeTotals). Passing `select` makes it
    // an explicit whitelist, so metadata/email must be listed too or they
    // silently come back undefined even though the columns exist.
    select: ["total", "metadata", "email"],
  })

  if (!order) return

  const sellerId: string | undefined = (order.metadata as any)?.seller_id
  const amountCents = Number(order.total ?? 0)

  // ATENÇÃO — pedidos do canal Mercado Livre (metadata.channel === "mercado_livre",
  // criados pelo webhook em src/api/webhooks/mercadolivre/route.ts) NUNCA recebem
  // shipping_address: essa é uma decisão de design do Task 5, não um bug de dados
  // ausentes. Por isso, TODOS os fallbacks abaixo ("Não informado", o CEP/cidade/UF
  // padrão da própria plataforma em Cachoeira/BA etc.) disparam para esses pedidos,
  // e a NF-e emitida hoje mostra um endereço fabricado, não o do comprador real do
  // Mercado Livre. Isso precisa ser resolvido — buscando e persistindo o endereço
  // real do comprador via GET /shipments/:id da API do Mercado Livre (usando o
  // mercadolivre_shipment_id já capturado no metadata do pedido) — antes de habilitar
  // a emissão fiscal real para pedidos do Mercado Livre em produção.
  const address = (order as any).shipping_address

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const rawItems = (order as any).items ?? []
  const { items, ncmFallbackUsed } = await buildFiscalItems(query, rawItems)

  await fiscalService.emitNfe({
    orderId,
    sellerId: sellerId ?? "unknown",
    amountCents,
    buyerName: address?.first_name
      ? `${address.first_name} ${address.last_name || ""}`.trim()
      : "Consumidor Final",
    buyerDocument: (order.metadata as any)?.buyer_document || "000.000.000-00",
    buyerEmail: (order as any).email || "",
    buyerAddress: {
      street: address?.address_1 || "Não informado",
      number: address?.address_2 || "S/N",
      district: (address?.metadata as any)?.district || "Centro",
      city: address?.city || "Cachoeira",
      state: address?.province || "BA",
      zipCode: address?.postal_code || "44300000",
    },
    items,
    ncmFallbackUsed,
  })
}

export const config: SubscriberConfig = {
  event: ["mercadopago.order_approved", "marketplace.order_placed"],
}
