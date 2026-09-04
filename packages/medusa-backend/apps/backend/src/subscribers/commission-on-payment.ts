import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IOrderModuleService } from "@medusajs/framework/types"
import { COMMISSION_MODULE } from "../modules/commission"
import { PAYOUT_MODULE } from "../modules/payout"
import CommissionModuleService from "../modules/commission/service"
import PayoutModuleService from "../modules/payout/service"

// Taxa de operação MercadoPago: 2,99% + R$0,39 por transação (estimativa).
// A parcela percentual escala naturalmente por pedido (soma dos produtos);
// a parcela fixa é por PAGAMENTO, não por pedido — quando um pagamento vira
// N pedidos (split multi-vendedor), ela é rateada proporcionalmente entre
// eles (mesmo algoritmo de rateio do frete em seller-order-groups.ts),
// senão os vendedores absorveriam R$0,39 cada em vez de R$0,39 no total.
const BANKING_FEE_PERCENT = 0.0299
const BANKING_FEE_FIXED = 39

type OrderItemLike = { unit_price?: number; quantity?: number }
type ShippingMethodLike = { amount?: number }

function sumProductsGross(items: OrderItemLike[] = []): number {
  return items.reduce((sum, item) => sum + Number(item.unit_price ?? 0) * Number(item.quantity ?? 0), 0)
}

function sumShipping(shippingMethods: ShippingMethodLike[] = []): number {
  return shippingMethods.reduce((sum, sm) => sum + Number(sm.amount ?? 0), 0)
}

export function allocateFixedFee(orders: Array<{ id: string; productsGross: number }>): Record<string, number> {
  const sorted = [...orders].sort((a, b) => a.id.localeCompare(b.id))
  const total = sorted.reduce((sum, o) => sum + o.productsGross, 0)

  const shares = sorted.map((o) =>
    total > 0 ? Math.floor((BANKING_FEE_FIXED * o.productsGross) / total) : 0
  )
  const allocated = shares.reduce((sum, s) => sum + s, 0)
  const remainder = BANKING_FEE_FIXED - allocated

  if (remainder !== 0 && sorted.length > 0) {
    let largestIndex = 0
    let largestGross = -1
    sorted.forEach((o, i) => {
      if (o.productsGross > largestGross) {
        largestGross = o.productsGross
        largestIndex = i
      }
    })
    shares[largestIndex] += remainder
  }

  const result: Record<string, number> = {}
  sorted.forEach((o, i) => { result[o.id] = shares[i] })
  return result
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
    relations: ["items", "shipping_methods"],
    // "metadata"/"created_at" precisam estar em select ou o Medusa não os
    // popula num retrieveOrder simples (mesma pegadinha de whitelist do
    // "total" — ver shouldIncludeTotals em @medusajs/order).
    select: ["metadata", "created_at"],
  })

  if (!order) return

  const existing = await commissionService.listCommissions({ orderId })
  if (existing.length > 0) return  // idempotência

  // sellerId vem do metadata do pedido (preenchido no checkout pelo storefront)
  const sellerId = (order.metadata?.seller_id as string) ?? "unknown"
  const productsGross = sumProductsGross((order as any).items)
  const shippingAmount = sumShipping((order as any).shipping_methods)
  const externalReference = order.metadata?.mercadopago_external_reference as string | undefined

  let fixedFeeShare = BANKING_FEE_FIXED
  if (externalReference) {
    const siblings = await orderService.listOrders(
      { metadata: { mercadopago_external_reference: externalReference } } as any,
      { relations: ["items"] }
    )
    if (siblings.length > 1) {
      const withGross = siblings.map((o: any) => ({ id: o.id, productsGross: sumProductsGross(o.items) }))
      fixedFeeShare = allocateFixedFee(withGross)[orderId] ?? 0
    }
  }

  const bankingFees = Math.round(productsGross * BANKING_FEE_PERCENT) + fixedFeeShare

  const commission = await commissionService.recordAndCreate({
    orderId,
    sellerId,
    grossAmount: productsGross,
    bankingFees,
    shippingAmount,
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
  // "order.payment_captured" não é um evento real do Medusa v2 (o evento nativo
  // de captura é "payment.captured", escopado no pagamento, não no pedido) e
  // nunca é emitido em lugar nenhum deste código — então esse subscriber nunca
  // disparava. "mercadopago.order_approved" é o evento que o webhook do
  // MercadoPago de fato emite pra cada pedido criado (mesmo evento já usado
  // por order-fiscal-emit.ts para a emissão de NF-e).
  event: "mercadopago.order_approved",
}
