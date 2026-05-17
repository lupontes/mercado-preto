import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"

const RegisterSchema = z.object({
  name: z.string().min(2, "Nome da loja obrigatório"),
  ownerName: z.string().min(2, "Nome do responsável obrigatório"),
  email: z.string().email("E-mail inválido"),
  phone: z.string().min(10, "Telefone inválido"),
  cpfCnpj: z.string().min(11, "CPF/CNPJ inválido"),
  bio: z.string().max(500).optional(),
  location: z.string().optional(),
  category: z.string().optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const existing = await sellerService.listSellers({ email: parsed.data.email })
  if (existing.length > 0) {
    return res.status(409).json({ error: "Este e-mail já está cadastrado" })
  }

  const seller = await sellerService.createSellers({
    ...parsed.data,
    status: "pending",
  })

  res.status(201).json({
    seller: {
      id: seller.id,
      name: seller.name,
      status: seller.status,
    },
    message: "Cadastro recebido! Nossa equipe irá analisar e entrar em contato em até 3 dias úteis.",
  })
}
