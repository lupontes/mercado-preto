import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"
import { CODE_TTL_MINUTES } from "../../../../modules/loyalty/constants"
import { sendBrevoEmail } from "../../../../utils/email"
import { validateDocument } from "../../../../utils/validate-document"

// The same answer whether or not the document ever bought here, so this form
// cannot be used to find out someone's purchase history.
const GENERIC_MESSAGE = "Se houver compras com este documento, enviamos um código para o e-mail usado nelas."

const Schema = z.object({ document: z.string() })

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = Schema.safeParse(req.body)
  const document = parsed.success ? validateDocument(parsed.data.document) : null
  if (!document?.valid || !document.digits) {
    return res.status(400).json({ error: "CPF ou CNPJ inválido." })
  }
  const digits = document.digits

  const checkout: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)
  const email = await checkout.findFirstPaidEmail(digits)
  if (email) {
    const loyalty: LoyaltyModuleService = req.scope.resolve(LOYALTY_MODULE)
    const code = await loyalty.issueCode(digits)
    // The code never reaches the logs: anyone reading them could use it.
    await sendBrevoEmail(
      email,
      "Seu código para usar os pontos do Mercado Preto",
      `
      <h2>Seu código: <strong>${code}</strong></h2>
      <p>Use este código no checkout do Mercado Preto para ver e usar seus pontos.</p>
      <p>Ele vale por ${CODE_TTL_MINUTES} minutos. Se você não pediu o código, ignore este e-mail.</p>
      <p>Com axé,<br>Equipe Mercado Preto — Mulheres de Axé do Brasil</p>
      `
    )
  }

  res.json({ message: GENERIC_MESSAGE })
}
