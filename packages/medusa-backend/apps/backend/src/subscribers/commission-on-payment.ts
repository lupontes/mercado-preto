import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IOrderModuleService } from "@medusajs/framework/types"
import { COMMISSION_MODULE } from "../modules/commission"
import CommissionModuleService from "../modules/commission/service"

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

  await commissionService.recordAndCreate({
    orderId,
    sellerId,
    grossAmount,
    bankingFees,
  })
}

export const config: SubscriberConfig = {
  event: "order.payment_captured",
}
