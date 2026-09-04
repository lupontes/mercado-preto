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
      relations: ["items"],
      order: { created_at: "DESC" },
      // "status"/"total"/"created_at"/"display_id" precisam estar em select ou
      // vêm undefined mesmo existindo na tabela (mesma pegadinha de whitelist
      // do "total" documentada em commission-on-payment.ts e
      // order-fiscal-emit.ts) — sem isso, o painel mostra Total/Status/Data
      // em branco ("Invalid Date") pro vendedor.
      select: ["status", "total", "created_at", "display_id"],
    }
  )

  res.json({ orders, count: orders.length, limit: Number(limit), offset: Number(offset) })
}
