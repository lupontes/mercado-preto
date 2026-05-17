import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { FISCAL_MODULE } from "../modules/fiscal"
import FiscalModuleService from "../modules/fiscal/service"
import { SELLER_MODULE } from "../modules/seller"

export default async function orderFiscalEmit({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  const fiscalService: FiscalModuleService = container.resolve(FISCAL_MODULE)

  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(orderId, {
    relations: ["items", "shipping_address", "customer"],
  })

  if (!order) return

  const sellerId: string | undefined = (order.metadata as any)?.seller_id
  const amountCents = Number(order.total ?? 0)

  const customer = (order as any).customer
  const address = (order as any).shipping_address

  await fiscalService.emitNfe({
    orderId,
    sellerId: sellerId ?? "unknown",
    amountCents,
    buyerName: customer?.first_name
      ? `${customer.first_name} ${customer.last_name || ""}`.trim()
      : address?.first_name
        ? `${address.first_name} ${address.last_name || ""}`.trim()
        : "Consumidor Final",
    buyerDocument: (order.metadata as any)?.buyer_document || "000.000.000-00",
    buyerEmail: customer?.email || "",
    buyerAddress: {
      street: address?.address_1 || "Não informado",
      number: address?.address_2 || "S/N",
      district: (address?.metadata as any)?.district || "Centro",
      city: address?.city || "Cachoeira",
      state: address?.province || "BA",
      zipCode: address?.postal_code || "44300000",
    },
    items: ((order as any).items ?? []).map((item: any) => ({
      description: item.title,
      quantity: item.quantity,
      unitPrice: Number(item.unit_price ?? 0),
    })),
  })
}

export const config: SubscriberConfig = {
  event: "order.payment_captured",
}
