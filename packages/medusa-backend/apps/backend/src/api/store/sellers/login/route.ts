import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"
import { createSellerToken } from "../../../../utils/seller-jwt"

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const { email, password } = parsed.data
  const [seller] = await sellerService.listSellers({ email })
  if (!seller) {
    return res.status(401).json({ error: "Credenciais inválidas" })
  }

  if (!seller.passwordHash) {
    return res.status(403).json({ error: "Conta sem senha configurada. Use o link enviado por e-mail." })
  }

  if (!SellerModuleService.verifyPassword(password, seller.passwordHash)) {
    return res.status(401).json({ error: "Credenciais inválidas" })
  }

  if (!["approved", "active"].includes(seller.status)) {
    return res.status(403).json({ error: "Conta não está ativa. Status atual: " + seller.status })
  }

  const token = createSellerToken(seller.id, seller.email)
  res.json({
    token,
    seller: { id: seller.id, name: seller.name, email: seller.email, status: seller.status },
  })
}
