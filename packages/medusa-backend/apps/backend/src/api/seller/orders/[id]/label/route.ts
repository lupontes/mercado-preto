import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { LABEL_ORDER_SELECT, notFound, redirectToPrint } from "../../../../../utils/label-print"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId

  let order: any
  try {
    order = await req.scope.resolve(Modules.ORDER).retrieveOrder(req.params.id, { select: LABEL_ORDER_SELECT })
  } catch {
    return notFound(res)
  }
  // Same 404 as a missing order, so ids of other stores cannot be probed.
  if (!sellerId || order?.metadata?.seller_id !== sellerId) return notFound(res)
  return redirectToPrint(req, res, order)
}
