import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IOrderModuleService } from "@medusajs/framework/types"
import { COMMISSION_MODULE } from "../modules/commission"
import { PAYOUT_MODULE } from "../modules/payout"
import CommissionModuleService from "../modules/commission/service"
import PayoutModuleService from "../modules/payout/service"
import { MARKETPLACE_CHANNEL_MODULE } from "../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../modules/marketplace-channel/service"

// Taxa de operação MercadoPago: 2,99% + R$0,39 por transação (estimativa)
function estimateBankingFees(grossAmount: number): number {
  return Math.round(grossAmount * 0.0299) + 39
}

export default async function commissionOnPayment({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id

  const orderService: IOrderModuleService = container.resolve(Modules.ORDER)
  const commissionService: CommissionModuleService = container.resolve(COMMISSION_MODULE)
  const payoutService: PayoutModuleService = container.resolve(PAYOUT_MODULE)

  const order = await orderService.retrieveOrder(orderId, {
    relations: ["items"],
    // "total" must be in select or Medusa never computes order totals
    // (order.total stays undefined, see order-summary decoration logic
    // in @medusajs/order's shouldIncludeTotals). Passing `select` makes it
    // an explicit whitelist, so metadata/created_at must be listed too or
    // they silently come back undefined even though the columns exist.
    select: ["total", "metadata", "created_at"],
  })

  if (!order) return

  // sellerId vem do metadata do pedido (preenchido no checkout pelo storefront)
  const sellerId = (order.metadata?.seller_id as string) ?? "unknown"
  const grossAmount = Number(order.total ?? 0)

  const channel = (order.metadata?.channel as string) ?? "mercadopago"

  let bankingFees: number
  if (channel === "mercado_livre") {
    const channelService: MarketplaceChannelModuleService = container.resolve(MARKETPLACE_CHANNEL_MODULE)
    const itemId = order.metadata?.mercadolivre_item_id as string | undefined
    const listing = itemId ? await channelService.findListingByExternalItemId(itemId) : null
    const feePercent = Number(listing?.saleFeePercent ?? 0)
    const feeFixed = Number(listing?.saleFeeFixed ?? 0)
    bankingFees = Math.round(grossAmount * (feePercent / 100) + feeFixed)
  } else {
    bankingFees = estimateBankingFees(grossAmount)
  }

  const existing = await commissionService.listCommissions({ orderId })
  if (existing.length > 0) return  // idempotência

  const commission = await commissionService.recordAndCreate({
    orderId,
    sellerId,
    grossAmount,
    bankingFees,
  })

  // Vínculo bidirecional: se já existe um payout pendente cobrindo esta comissão
  // (ex: pagamento confirmado com atraso, depois que o payout do período já foi
  // criado), vincula agora em vez de deixar a comissão órfã até um payout futuro.
  const pendingPayouts = await payoutService.listPayouts({ sellerId, status: "pending" })
  const orderDate = new Date((order as any).created_at)
  const covering = pendingPayouts
    .filter((p: any) => orderDate >= new Date(p.periodStart) && orderDate <= new Date(p.periodEnd))
    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  if (covering[0]) {
    await commissionService.linkSingleCommissionToPayout((commission as any).id, covering[0].id)
    await payoutService.incrementAmount(covering[0].id, Number((commission as any).sellerPayout))
  }
}

export const config: SubscriberConfig = {
  // Escuta tanto pedidos vindos do checkout próprio (MercadoPago) quanto de
  // canais de venda externos (Mercado Livre) — ver marketplace-channel.
  event: ["order.payment_captured", "marketplace.order_placed"],
}
