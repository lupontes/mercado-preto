import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { getShippingCalculator } from "../../../../utils/melhor-envio"
import { defaultQuoteCache, quoteFailureResponse, quoteShipping } from "../../../../utils/shipping-quote"

export const quoteRequestSchema = z.object({
  postalCode: z.string().refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido. Informe 8 dígitos."),
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(50, "O carrinho pode ter no máximo 50 itens."),
})

// Prices, weights and the seller of each item come from the database — the
// browser only says what is in the cart and where it goes.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = quoteRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." })
  }

  const logger = req.scope.resolve("logger")
  try {
    const quote = await quoteShipping(
      {
        query: req.scope.resolve(ContainerRegistrationKeys.QUERY),
        calculator: getShippingCalculator(),
        cache: defaultQuoteCache,
        logger,
      },
      parsed.data
    )
    res.json(quote)
  } catch (err) {
    const failure = quoteFailureResponse(err, logger)
    res.status(failure.status).json(failure.body)
  }
}
