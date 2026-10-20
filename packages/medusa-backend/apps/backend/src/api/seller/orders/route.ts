import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { IOrderModuleService } from "@medusajs/framework/types"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { limit = 20, offset = 0 } = req.query as Record<string, string>

  const orderService: IOrderModuleService = req.scope.resolve(Modules.ORDER)
  const orders = await orderService.listOrders(
    { metadata: { seller_id: sellerId } } as any,
    {
      take: Number(limit),
      skip: Number(offset),
      relations: ["items", "shipping_methods"],
      order: { created_at: "DESC" },
      // "status"/"created_at"/"display_id" precisam estar em select ou vêm
      // undefined mesmo existindo na tabela (mesma pegadinha de whitelist do
      // Medusa documentada em commission-on-payment.ts e order-fiscal-emit.ts).
      // "total" É DE PROPÓSITO deixado fora: pedir o total decorado do Medusa
      // numa consulta de lista (listOrders, não retrieveOrder) quebra com
      // "Shipping method version is required to load adjustments" pra pedidos
      // criados via orderService.createOrders() no webhook do MercadoPago
      // (não passam pelo fluxo completo de carrinho/checkout do Medusa, que
      // preenche esse campo de versionamento). O total é calculado abaixo, a
      // partir dos itens e do frete já carregados via relations.
      // "metadata" is read only to extract shipping_status; it is stripped from
      // the response below because it also holds the buyer's CPF.
      select: ["status", "created_at", "display_id", "metadata"],
    }
  )

  const ordersWithTotal = orders.map(({ metadata, ...order }: any) => ({
    ...order,
    shipping_status: metadata?.shipping_status ?? null,
    // Only these three fields: the label state also holds Melhor Envio ids and errors.
    shipping_label: metadata?.shipping_label
      ? {
          status: metadata.shipping_label.status,
          tracking_code: metadata.shipping_label.trackingCode ?? null,
          post_by: metadata.shipping_label.postBy ?? null,
        }
      : null,
    total:
      (order.items ?? []).reduce(
        (sum: number, item: any) => sum + Number(item.unit_price ?? 0) * Number(item.quantity ?? 0),
        0
      ) +
      (order.shipping_methods ?? []).reduce((sum: number, sm: any) => sum + Number(sm.amount ?? 0), 0),
  }))

  res.json({ orders: ordersWithTotal, count: orders.length, limit: Number(limit), offset: Number(offset) })
}
