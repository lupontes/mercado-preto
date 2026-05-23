import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MercadoPagoConfig, Payment } from "mercadopago"
import { z } from "zod"

const schema = z.object({
  token: z.string().optional(),
  payment_method_id: z.string(),
  installments: z.number().int().positive().optional(),
  issuer_id: z.string().optional(),
  transaction_amount: z.number().positive(),
  external_reference: z.string(),
  payer: z.object({
    email: z.string().email(),
    identification: z
      .object({ type: z.string(), number: z.string() })
      .optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  }),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(503).json({ error: "MercadoPago não configurado." })
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }

  const {
    token,
    payment_method_id,
    installments,
    issuer_id,
    transaction_amount,
    external_reference,
    payer,
  } = parsed.data

  const mp = new MercadoPagoConfig({ accessToken })
  const paymentClient = new Payment(mp)

  try {
    const payment = await paymentClient.create({
      body: {
        token,
        payment_method_id,
        installments: installments ?? 1,
        issuer_id: issuer_id ? Number(issuer_id) : undefined,
        transaction_amount,
        external_reference,
        payer,
        description: "Pedido Mercado Preto",
        statement_descriptor: "MERCADO PRETO",
      },
      requestOptions: { idempotencyKey: crypto.randomUUID() },
    })

    res.json({
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      point_of_interaction: payment.point_of_interaction,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    res.status(500).json({ error: "Erro ao processar pagamento.", detail: msg })
  }
}
