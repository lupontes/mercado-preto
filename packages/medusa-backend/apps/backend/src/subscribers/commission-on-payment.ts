import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IOrderModuleService } from "@medusajs/framework/types"
import { COMMISSION_MODULE } from "../modules/commission"
import { PAYOUT_MODULE } from "../modules/payout"
import CommissionModuleService from "../modules/commission/service"
import PayoutModuleService from "../modules/payout/service"

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
  })

  if (!order) return

  // sellerId vem do metadata do pedido (preenchido no checkout pelo storefront)
  const sellerId = (order.metadata?.seller_id as string) ?? "unknown"
  const grossAmount = Number(order.total ?? 0)
  const bankingFees = estimateBankingFees(grossAmount)

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
  const created = new Date((commission as any).created_at)
  const covering = pendingPayouts
    .filter((p: any) => created >= new Date(p.periodStart) && created <= new Date(p.periodEnd))
    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  if (covering[0]) {
    await commissionService.linkSingleCommissionToPayout((commission as any).id, covering[0].id)
    await payoutService.incrementAmount(covering[0].id, Number((commission as any).sellerPayout))
  }
}

export const config: SubscriberConfig = {
  event: "order.payment_captured",
}
