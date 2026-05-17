import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MercadoPagoConfig, Payment } from "mercadopago"

type MPWebhookBody = {
  type?: string
  action?: string
  data?: { id?: string }
}

function verifySignature(req: MedusaRequest, secret: string): boolean {
  const xSignature = req.headers["x-signature"] as string | undefined
  const xRequestId = req.headers["x-request-id"] as string | undefined

  if (!xSignature) return false

  const parts = Object.fromEntries(
    xSignature.split(",").flatMap((part) => {
      const [k, ...v] = part.trim().split("=")
      return k ? [[k, v.join("=")]] : []
    })
  )
  const ts = parts["ts"]
  const v1 = parts["v1"]

  if (!ts || !v1) return false

  const dataId = (req.body as MPWebhookBody)?.data?.id ?? ""
  const message = `id:${dataId};request-id:${xRequestId ?? ""};ts:${ts};`
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex")

  try {
    return crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"))
  } catch {
    return false
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN

  if (webhookSecret) {
    if (!verifySignature(req, webhookSecret)) {
      logger.warn("[mercadopago/webhook] assinatura inválida — requisição rejeitada")
      return res.sendStatus(401)
    }
  }

  const body = req.body as MPWebhookBody
  const isPaymentNotification =
    body.type === "payment" || body.action?.startsWith("payment")

  if (!isPaymentNotification) {
    return res.sendStatus(200)
  }

  const paymentId = body.data?.id
  if (!paymentId || !accessToken) return res.sendStatus(200)

  try {
    const mp = new MercadoPagoConfig({ accessToken })
    const paymentClient = new Payment(mp)
    const payment = await paymentClient.get({ id: Number(paymentId) })

    logger.info(
      `[mercadopago/webhook] payment ${payment.id} | status: ${payment.status} | ref: ${payment.external_reference}`
    )

    if (payment.status === "approved") {
      logger.info(
        `[mercadopago/webhook] pagamento aprovado — R$ ${payment.transaction_amount} | ref: ${payment.external_reference}`
      )
      // Ponto de extensão: criar pedido Medusa, acionar commissão, notificar vendedor.
      // O snapshot do pedido original está em payment.metadata.
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error("[mercadopago/webhook] erro ao processar notificação:", err)
    // Retornar 200 para evitar retentativas do MP em erros não-recuperáveis
    res.sendStatus(200)
  }
}
