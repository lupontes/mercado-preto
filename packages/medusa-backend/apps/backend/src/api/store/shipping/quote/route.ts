import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { COMMISSION_MODULE } from "../../../../modules/commission"
import type CommissionModuleService from "../../../../modules/commission/service"
import { CENTS_PER_POINT } from "../../../../modules/loyalty/constants"
import { loyaltyDiscountCap } from "../../../../utils/loyalty-discount"
import { getShippingCalculator } from "../../../../utils/melhor-envio"
import { defaultQuoteCache, quoteFailureResponse, quoteShipping } from "../../../../utils/shipping-quote"

export const quoteRequestSchema = z.object({
  postalCode: z.string().refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido. Informe 8 dígitos."),
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(50, "O carrinho pode ter no máximo 50 itens."),
})

// The storefront offers at most this much in points. It must match the cap the
// preference route enforces, so it uses the same catalog prices (first BRL
// price, as in resolveCheckoutItems) and the same whole-point rounding.
async function maxLoyaltyDiscountCents(
  query: { graph: (args: any) => Promise<{ data: any[] }> },
  commission: CommissionModuleService,
  items: Array<{ variantId: string; quantity: number }>
): Promise<number> {
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "prices.amount", "prices.currency_code"],
    filters: { id: items.map((i) => i.variantId) },
  })
  const priceById = new Map<string, number>(
    variants.map((v: any) => [v.id, Number(v.prices?.find((p: any) => p.currency_code === "brl")?.amount ?? 0)])
  )
  const itemsTotal = items.reduce((sum, i) => sum + (priceById.get(i.variantId) ?? 0) * i.quantity, 0)
  const capPoints = Math.floor(loyaltyDiscountCap(itemsTotal, await commission.getCommissionRate()) / CENTS_PER_POINT)
  return capPoints * CENTS_PER_POINT
}

// Prices, weights and the seller of each item come from the database — the
// browser only says what is in the cart and where it goes.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = quoteRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." })
  }

  const logger = req.scope.resolve("logger")
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const quote = await quoteShipping(
      {
        query,
        calculator: getShippingCalculator(),
        cache: defaultQuoteCache,
        logger,
      },
      parsed.data
    )
    const commission: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
    res.json({ ...quote, maxLoyaltyDiscountCents: await maxLoyaltyDiscountCents(query, commission, parsed.data.items) })
  } catch (err) {
    const failure = quoteFailureResponse(err, logger)
    res.status(failure.status).json(failure.body)
  }
}
