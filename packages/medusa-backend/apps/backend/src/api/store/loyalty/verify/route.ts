import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"
import { signLoyaltyToken } from "../../../../utils/loyalty-token"
import { validateDocument } from "../../../../utils/validate-document"

const Schema = z.object({ document: z.string(), code: z.string().regex(/^\d{6}$/) })

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = Schema.safeParse(req.body)
  const document = parsed.success ? validateDocument(parsed.data.document) : null
  if (!parsed.success || !document?.valid || !document.digits) {
    return res.status(400).json({ error: "Código inválido ou expirado." })
  }
  const digits = document.digits

  const loyalty: LoyaltyModuleService = req.scope.resolve(LOYALTY_MODULE)
  if (!(await loyalty.verifyCode(digits, parsed.data.code))) {
    return res.status(400).json({ error: "Código inválido ou expirado." })
  }

  res.json({ token: signLoyaltyToken(digits), balance: await loyalty.availableBalance(digits) })
}
