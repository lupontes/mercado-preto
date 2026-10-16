import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { z } from "zod"

const Body = z.object({ status: z.literal("approved") })

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Status inválido" })

  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [product] } = await query.graph({ entity: "product", fields: ["id", "metadata"], filters: { id } })
  if (!product) return res.status(404).json({ error: "Produto não encontrado" })

  // The full metadata object is sent so the update never drops other keys.
  const updated = await req.scope.resolve(Modules.PRODUCT).updateProducts(id, {
    metadata: { ...(product.metadata ?? {}), package_review: parsed.data.status },
  })
  res.json({ product: updated })
}
