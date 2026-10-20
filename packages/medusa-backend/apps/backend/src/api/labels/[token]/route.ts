import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { LABEL_ORDER_SELECT, notFound, redirectToPrint } from "../../../utils/label-print"
import { verifyLabelToken } from "../../../utils/label-token"

// Public on purpose: the signed token in the URL is the credential, so the
// seller can print without logging in.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const verified = verifyLabelToken(String(req.params.token ?? ""))
  if (!verified) return notFound(res)

  let order: any
  try {
    order = await req.scope.resolve(Modules.ORDER).retrieveOrder(verified.orderId, { select: LABEL_ORDER_SELECT })
  } catch {
    return notFound(res)
  }
  return redirectToPrint(req, res, order)
}
