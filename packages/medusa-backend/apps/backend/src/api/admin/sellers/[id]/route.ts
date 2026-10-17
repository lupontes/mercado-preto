import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"
import { parseAddressBlock } from "../../../../utils/seller-address"
import { toAdminSeller } from "../../../../utils/admin-seller"

const UpdateSellerSchema = z.object({
  name: z.string().min(2).optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  category: z.string().optional(),
  bankName: z.string().optional(),
  bankAgency: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountType: z.enum(["checking", "savings"]).optional(),
  pixKey: z.string().optional(),
  pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).optional(),
  mercadopagoUserId: z.string().optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const [seller] = await sellerService.listSellers({ id })
  if (!seller) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  res.json({ seller: toAdminSeller(seller as any) })
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const block = parseAddressBlock((req.body ?? {}) as Record<string, unknown>)
  if (!block.ok) {
    return res.status(400).json({ error: "Endereço inválido", details: block.error.flatten() })
  }
  const parsed = UpdateSellerSchema.safeParse(block.rest)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const [seller] = await sellerService.updateSellers({
    selector: { id },
    data: { ...parsed.data, ...(block.address ?? {}) },
  })

  res.json({ seller: toAdminSeller(seller as any) })
}
