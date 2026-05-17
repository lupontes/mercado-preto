import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"

const SetPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres"),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const parsed = SetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const { email, password } = parsed.data
  const [seller] = await sellerService.listSellers({ email })
  if (!seller) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  if (!["approved", "active"].includes(seller.status)) {
    return res.status(403).json({ error: "Conta ainda não aprovada. Aguarde a análise da equipe." })
  }

  const passwordHash = SellerModuleService.hashPassword(password)
  await sellerService.updateSellers({
    selector: { id: seller.id },
    data: { passwordHash, status: "active" as const },
  })

  res.json({ message: "Senha configurada com sucesso. Agora você pode acessar o portal do vendedor." })
}
