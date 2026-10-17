import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MercadoPagoConfig, Payment } from "mercadopago"
import { z } from "zod"
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"
import { paymentErrorMessage, rejectionMessage } from "../../../../utils/mercadopago-messages"

const schema = z.object({
  token: z.string().optional(),
  payment_method_id: z.string(),
  installments: z.number().int().positive().optional(),
  issuer_id: z.string().optional(),
  // Sent by the old storefront during deploy; accepted but never charged.
  transaction_amount: z.number().optional(),
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
    external_reference,
    payer,
  } = parsed.data

  const checkout: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)
  const logger = req.scope.resolve("logger") as {
    warn: (msg: string) => void
    error: (msg: string) => void
  }

  const snapshot = await checkout.findByExternalReference(external_reference)
  if (!snapshot) {
    return res.status(404).json({ error: "Pedido não encontrado." })
  }
  // A null status belongs to snapshots created before status tracking: pending.
  if ((snapshot.status ?? "pending") !== "pending") {
    return res.status(409).json({ error: "Este pedido já foi pago." })
  }

  const mp = new MercadoPagoConfig({ accessToken })
  const paymentClient = new Payment(mp)
  const backendUrl = process.env.BACKEND_URL

  try {
    const payment = await paymentClient.create({
      body: {
        token,
        payment_method_id,
        installments: installments ?? 1,
        issuer_id: issuer_id ? Number(issuer_id) : undefined,
        // The browser value is untrusted: charge the server-side snapshot total.
        transaction_amount: snapshot.payload.total / 100,
        external_reference,
        payer,
        description: "Pedido Mercado Preto",
        statement_descriptor: "MERCADO PRETO",
        ...(backendUrl ? { notification_url: `${backendUrl}/webhooks/mercadopago` } : {}),
      },
      requestOptions: { idempotencyKey: crypto.randomUUID() },
    })

    if (payment.status === "approved") {
      // The card is already charged: a failure here must not become a 500,
      // or the buyer would retry and be charged twice.
      try {
        const won = await checkout.transitionFromPending(
          external_reference,
          "paid",
          String(payment.id)
        )
        if (!won) {
          logger.warn(
            `[checkout/payment] snapshot ${external_reference} não estava mais pendente quando o pagamento ${payment.id} foi aprovado`
          )
        }
      } catch (transitionErr: unknown) {
        const detail = transitionErr instanceof Error ? transitionErr.message : String(transitionErr)
        logger.error(
          `[checkout/payment] falha ao marcar o snapshot ${external_reference} como pago (pagamento ${payment.id}): ${detail}`
        )
      }
    }

    res.json({
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      point_of_interaction: payment.point_of_interaction,
      // The snapshot stays pending, so the buyer can retry on the same order.
      ...(payment.status === "rejected" ? { message: rejectionMessage(payment.status_detail) } : {}),
    })
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : JSON.stringify(err)
    logger.error(`[checkout/payment] falha no Mercado Pago para ${external_reference}: ${raw}`)
    res.status(502).json({ error: paymentErrorMessage(err) })
  }
}
