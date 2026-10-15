import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../modules/seller"
import SellerModuleService from "../../../modules/seller/service"
import { parseAddressBlock } from "../../../utils/seller-address"

const UpdateProfileSchema = z.object({
  bio: z.string().max(500).optional(),
  location: z.string().optional(),
  category: z.string().optional(),
  bankName: z.string().optional(),
  bankAgency: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountType: z.enum(["checking", "savings"]).optional(),
  pixKey: z.string().optional(),
  pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const sellerId = (req as any).sellerId

  const [seller] = await sellerService.listSellers({ id: sellerId })
  if (!seller) return res.status(404).json({ error: "Vendedor não encontrado" })

  const { passwordHash, ...safe } = seller as any
  res.json({ seller: safe })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const sellerId = (req as any).sellerId

  const block = parseAddressBlock((req.body ?? {}) as Record<string, unknown>)
  if (!block.ok) {
    return res.status(400).json({ error: "Endereço inválido", details: block.error.flatten() })
  }
  const parsed = UpdateProfileSchema.safeParse(block.rest)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const [seller] = await sellerService.updateSellers({
    selector: { id: sellerId },
    data: { ...parsed.data, ...(block.address ?? {}) },
  })

  const { passwordHash, ...safe } = seller as any
  res.json({ seller: safe })
}
