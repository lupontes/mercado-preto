import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../modules/seller"
import SellerModuleService from "../../../modules/seller/service"

const CreateSellerSchema = z.object({
  name: z.string().min(2),
  ownerName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10),
  cpfCnpj: z.string().min(11),
  bio: z.string().optional(),
  location: z.string().optional(),
  category: z.string().optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const { status, limit = 20, offset = 0 } = req.query as Record<string, string>

  const filters = status ? { status } : {}
  const sellers = await sellerService.listSellers(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { createdAt: "DESC" },
  })

  const count = await sellerService.listSellers(filters).then((s) => s.length)

  res.json({ sellers, count, limit: Number(limit), offset: Number(offset) })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const parsed = CreateSellerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const [seller] = await sellerService.createSellers(parsed.data)
  res.status(201).json({ seller })
}
