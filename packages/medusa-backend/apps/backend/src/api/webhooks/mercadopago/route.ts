import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Payment, Preference } from "mercadopago"
import type { SellerGroup } from "../../../utils/seller-order-groups"

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

      // MP does not propagate preference.metadata to the payment object.
      // Fetch the preference by external_reference to recover the order snapshot.
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
            logger.info(`[mercadopago/webhook] metadados recuperados da preferência ${prefId}`)
          }
        } catch (prefErr) {
          logger.warn(`[mercadopago/webhook] falha ao buscar preferência: ${prefErr}`)
        }
      }

      const addr = meta?.address as Record<string, string> | undefined
      const shipping: { name: string; price: number } | undefined = meta?.shipping

      const sellerGroups: SellerGroup[] = Array.isArray(meta?.seller_groups)
        ? meta.seller_groups
        : [
            {
              sellerId: meta?.seller_id,
              subtotal: 0,
              shippingShare: shipping?.price ?? 0,
              items: meta?.items ?? [],
            } as SellerGroup,
          ]

      const orderService = req.scope.resolve(Modules.ORDER)
      const eventBusService = req.scope.resolve(Modules.EVENT_BUS)

      const pendingGroups: SellerGroup[] = []
      for (const group of sellerGroups) {
        const existing = await orderService.listOrders(
          {
            metadata: {
              mercadopago_external_reference: payment.external_reference,
              seller_id: group.sellerId,
            },
          } as any,
          { take: 1 }
        )
        if (existing.length === 0) pendingGroups.push(group)
      }

      if (pendingGroups.length === 0) {
        logger.info(
          `[mercadopago/webhook] todos os pedidos já existem para ref ${payment.external_reference} — ignorando webhook duplicado`
        )
        return res.sendStatus(200)
      }

      const createdOrders = await orderService.createOrders(
        pendingGroups.map((group) => ({
          currency_code: "brl",
          email: addr?.email ?? (payment.payer as any)?.email,
          shipping_address: {
            first_name: addr?.first_name ?? (payment.payer as any)?.name ?? "",
            last_name: addr?.last_name ?? (payment.payer as any)?.surname ?? "",
            phone: addr?.phone ?? (payment.payer as any)?.phone?.number ?? "",
            address_1: addr?.address_1 ?? (payment.payer as any)?.address?.street_name ?? "",
            address_2: addr?.address_2 ?? "",
            city: addr?.city ?? "",
            province: addr?.state ?? "",
            country_code: "br",
            postal_code: addr?.postal_code ?? (payment.payer as any)?.address?.zip_code ?? "",
          },
          items: group.items.map((i) => ({
            title: i.title,
            quantity: i.quantity,
            unit_price: i.price,
            ...(i.variant_id ? { variant_id: i.variant_id } : {}),
          })),
          shipping_methods: shipping ? [{ name: shipping.name, amount: group.shippingShare }] : [],
          metadata: {
            mercadopago_payment_id: String(payment.id),
            mercadopago_external_reference: payment.external_reference,
            seller_id: group.sellerId,
            buyer_document: meta?.buyer_document,
          },
        }))
      )

      logger.info(
        `[mercadopago/webhook] ${createdOrders.length} pedido(s) criado(s) para ref ${payment.external_reference}`
      )

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

    res.sendStatus(200)
  } catch (err) {
    logger.error("[mercadopago/webhook] erro ao processar notificação:", err)
    // Retornar 200 para evitar retentativas do MP em erros não-recuperáveis
    res.sendStatus(200)
  }
}
