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
    }
  )

  res.json({ orders, count: orders.length, limit: Number(limit), offset: Number(offset) })
}
