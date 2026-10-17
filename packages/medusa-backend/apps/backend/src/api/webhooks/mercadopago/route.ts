import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Payment, Preference } from "mercadopago"
import { createOrdersFromCheckout } from "../../../utils/create-orders-from-checkout"
import { CHECKOUT_MODULE } from "../../../modules/checkout"
import type CheckoutModuleService from "../../../modules/checkout/service"

type MPWebhookBody = {
  type?: string
  action?: string
  data?: { id?: string }
}

/**
 * Signature spec (MercadoPago docs): dataId comes from the `data.id` query
 * param (not the body), lowercased, and any part whose value is absent is
 * omitted entirely from the manifest — not left as an empty segment.
 * Returns the parsed manifest for logging purposes.
 */
function buildManifest(
  xSignature: string,
  xRequestId: string | undefined,
  dataId: string,
): { ts: string; v1: string; message: string } | null {
  const parts = Object.fromEntries(
    xSignature.split(",").flatMap((part) => {
      const [k, ...v] = part.trim().split("=")
      return k ? [[k, v.join("=")]] : []
    })
  )
  const ts = parts["ts"]
  const v1 = parts["v1"]

  if (!ts || !v1) return null

  const manifestParts: string[] = []
  if (dataId) manifestParts.push(`id:${dataId}`)
  if (xRequestId) manifestParts.push(`request-id:${xRequestId}`)
  manifestParts.push(`ts:${ts}`)
  const message = manifestParts.join(";") + ";"

  return { ts, v1, message }
}

function verifySignature(req: MedusaRequest, secret: string): { ok: boolean; reason?: string } {
  const xSignature = req.headers["x-signature"] as string | undefined
  const xRequestId = req.headers["x-request-id"] as string | undefined

  if (!xSignature) return { ok: false, reason: "x-signature absent" }

  const dataId = String(req.query?.["data.id"] ?? "").toLowerCase()
  const parsed = buildManifest(xSignature, xRequestId, dataId)

  if (!parsed) return { ok: false, reason: "malformed x-signature (missing ts or v1)" }

  const { ts, v1, message } = parsed
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex")

  try {
    const timingOk = crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"))
    return timingOk ? { ok: true } : { ok: false, reason: `v1 mismatch (got ${v1.slice(0, 8)}...)` }
  } catch {
    return { ok: false, reason: "timingSafeEqual error" }
  }
}

// MP reports reais as a float; rounding avoids false mismatches such as
// 10.1 * 100 === 1009.9999999999999.
function paidCents(payment: any): number {
  return Math.round(Number(payment.transaction_amount) * 100)
}

async function createOrdersAndEmit(req: MedusaRequest, payment: any, meta: Record<string, any>) {
  const logger = req.scope.resolve("logger")

  const createdOrders = await createOrdersFromCheckout({
    container: req.scope,
    externalReference: payment.external_reference as string,
    meta,
    extraMetadata: { mercadopago_payment_id: String(payment.id) },
    fallbackPayer: payment.payer as Record<string, any> | undefined,
  })

  if (createdOrders.length === 0) {
    logger.info(
      `[mercadopago/webhook] todos os pedidos já existem para ref ${payment.external_reference} — ignorando webhook duplicado`
    )
    return
  }

  logger.info(
    `[mercadopago/webhook] ${createdOrders.length} pedido(s) criado(s) para ref ${payment.external_reference}`
  )

  const eventBusService = req.scope.resolve(Modules.EVENT_BUS)

  // order.placed              → WhatsApp de confirmação
  // mercadopago.order_approved → emissão NF-e (evento customizado para evitar
  //                              conflito com subscriber interno do Medusa para
  //                              order.payment_captured)
  await eventBusService.emit(
    createdOrders.flatMap((order: any) => [
      { name: "order.placed", data: { id: order.id } },
      { name: "mercadopago.order_approved", data: { id: order.id } },
    ])
  )
}

/**
 * A snapshot becomes orders through at most one payment, and only when that
 * payment covered the server-priced total. The Brick route may already have
 * marked the snapshot `paid` with this same payment, which still needs orders.
 */
async function settleSnapshotPayment(
  req: MedusaRequest,
  checkoutService: CheckoutModuleService,
  payment: any,
  snapshot: any,
) {
  const logger = req.scope.resolve("logger")
  const ref = payment.external_reference as string
  const paymentId = String(payment.id)
  const paid = paidCents(payment)
  const expected = snapshot.payload?.total

  let current = snapshot
  if ((current.status ?? "pending") === "pending") {
    const matches = paid === expected
    const won = await checkoutService.transitionFromPending(ref, matches ? "paid" : "amount_mismatch", paymentId)
    if (won && !matches) {
      logger.error(
        `[mercadopago/webhook] valor divergente para ref ${ref}, payment ${paymentId}: pago ${paid} centavos, esperado ${expected} centavos — snapshot marcado amount_mismatch, pedido NÃO criado`
      )
      return
    }
    // Losing means another notification or the Brick settled it first; its
    // outcome decides what this payment may do.
    current = won
      ? { ...current, status: "paid", paymentId }
      : await checkoutService.findByExternalReference(ref)
    if (!current) {
      logger.error(`[mercadopago/webhook] snapshot da ref ${ref} sumiu durante o processamento do payment ${paymentId}`)
      return
    }
  }

  if (current.status === "amount_mismatch") {
    logger.error(
      `[mercadopago/webhook] payment ${paymentId} (${paid} centavos) bloqueado: ref ${ref} já está em amount_mismatch (payment ${current.paymentId}) — pedido NÃO criado, estornar manualmente`
    )
    return
  }

  if (String(current.paymentId) !== paymentId) {
    logger.error(
      `[mercadopago/webhook] pagamento extra para ref ${ref}: payment ${paymentId} (${paid} centavos) chegou depois do payment ${current.paymentId} (${expected} centavos) já ter pago o snapshot — pedido NÃO criado, estornar manualmente`
    )
    return
  }

  const meta = current.payload as Record<string, any> | undefined
  if (!meta?.items?.length) {
    logger.error(
      `[mercadopago/webhook] snapshot da ref ${ref} sem itens — pedido NÃO criado, payment ${paymentId}`
    )
    return
  }

  if (!(await checkoutService.claimOrderCreation(ref))) return

  try {
    await createOrdersAndEmit(req, payment, meta)
  } catch (err) {
    // Without the release a transient failure would leave the snapshot claimed
    // forever and the next notification could never create the orders.
    await checkoutService.releaseOrderCreation(ref)
    logger.error(`[mercadopago/webhook] falha ao criar pedidos para ref ${ref}, payment ${paymentId}:`, err)
  }
}

// Checkouts created before the local snapshot existed: recover their metadata
// from MercadoPago and rely on createOrdersFromCheckout's idempotency.
async function settleLegacyPayment(req: MedusaRequest, mp: MercadoPagoConfig, payment: any) {
  const logger = req.scope.resolve("logger")

  let meta = payment.metadata as Record<string, any> | undefined
  if ((!meta?.items?.length) && payment.external_reference) {
    try {
      const prefClient = new Preference(mp)
      const searchResult = await prefClient.search({
        options: { external_reference: payment.external_reference },
      })
      const prefId = searchResult.elements?.[0]?.id
      if (prefId) {
        const pref = await prefClient.get({ preferenceId: prefId })
        meta = pref.metadata as Record<string, any> | undefined
        logger.info(`[mercadopago/webhook] metadados recuperados da preferência ${prefId} (fallback legado)`)
      }
    } catch (prefErr) {
      logger.warn(`[mercadopago/webhook] falha ao buscar preferência (fallback legado): ${prefErr}`)
    }
  }

  if (!meta?.items?.length) {
    logger.error(
      `[mercadopago/webhook] metadados do checkout não recuperados (snapshot ausente, payment.metadata vazio, busca de preferência sem resultado) — pedido NÃO criado pra ref ${payment.external_reference}, payment ${payment.id}`
    )
    return
  }

  const paid = paidCents(payment)
  if (typeof meta.total !== "number" || meta.total !== paid) {
    logger.error(
      `[mercadopago/webhook] valor divergente (fallback legado) para ref ${payment.external_reference}, payment ${payment.id}: pago ${paid} centavos, esperado ${meta.total ?? "ausente"} centavos — pedido NÃO criado`
    )
    return
  }

  await createOrdersAndEmit(req, payment, meta)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN

  if (!webhookSecret) {
    logger.error("[mercadopago/webhook] MERCADOPAGO_WEBHOOK_SECRET não configurado — webhook rejeitado")
    return res.status(500).json({ error: "Webhook secret not configured" })
  }

  const xSignature = req.headers["x-signature"] as string | undefined
  const xRequestId = req.headers["x-request-id"] as string | undefined
  const dataId = String(req.query?.["data.id"] ?? "").toLowerCase()

  logger.info(`[mercadopago/webhook] x-signature: ${xSignature ?? "ausente"}`)
  logger.info(`[mercadopago/webhook] x-request-id: ${xRequestId ?? "ausente"}`)
  logger.info(`[mercadopago/webhook] data.id: ${dataId}`)

  const parsed = buildManifest(xSignature ?? "", xRequestId, dataId)
  if (parsed) {
    const expected = crypto.createHmac("sha256", webhookSecret).update(parsed.message).digest("hex")
    logger.info(`[mercadopago/webhook] manifest: ${parsed.message}`)
    logger.info(`[mercadopago/webhook] expected v1: ${expected}`)
    logger.info(`[mercadopago/webhook] received v1: ${parsed.v1}`)
  }

  const result = verifySignature(req, webhookSecret)
  if (!result.ok) {
    logger.warn(`[mercadopago/webhook] assinatura inválida — ${result.reason}`)
    return res.sendStatus(401)
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

      const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)

      // The local snapshot (written when the checkout was priced on the server)
      // is the only source we trust for what was sold and for how much; payment
      // metadata and the legacy preference lookup are only for checkouts that
      // predate it.
      let snapshot: any = null
      if (payment.external_reference) {
        try {
          snapshot = await checkoutService.findByExternalReference(payment.external_reference)
        } catch (snapshotErr) {
          logger.warn(`[mercadopago/webhook] falha ao consultar snapshot local: ${snapshotErr}`)
        }
      }

      if (snapshot) {
        await settleSnapshotPayment(req, checkoutService, payment, snapshot)
      } else {
        await settleLegacyPayment(req, mp, payment)
      }
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error("[mercadopago/webhook] erro ao processar notificação:", err)
    // Retornar 200 para evitar retentativas do MP em erros não-recuperáveis
    res.sendStatus(200)
  }
}
