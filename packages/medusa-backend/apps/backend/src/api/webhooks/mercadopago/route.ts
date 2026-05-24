import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Payment, Preference } from "mercadopago"

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
      const mpItems: { variant_id?: string; title: string; quantity: number; price: number }[] =
        meta?.items ?? []
      const shipping: { name: string; price: number } | undefined = meta?.shipping

      const orderService = req.scope.resolve(Modules.ORDER)
      const eventBusService = req.scope.resolve(Modules.EVENT_BUS)

      const [order] = await orderService.createOrders([
        {
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
          items: mpItems.map((i) => ({
            title: i.title,
            quantity: i.quantity,
            unit_price: i.price,
            ...(i.variant_id ? { variant_id: i.variant_id } : {}),
          })),
          shipping_methods: shipping
            ? [{ name: shipping.name, amount: shipping.price }]
            : [],
          metadata: {
            mercadopago_payment_id: String(payment.id),
            mercadopago_external_reference: payment.external_reference,
          },
        },
      ])

      logger.info(`[mercadopago/webhook] pedido criado: ${order.id}`)

      // order.placed              → WhatsApp de confirmação
      // mercadopago.order_approved → emissão NF-e (evento customizado para evitar
      //                              conflito com subscriber interno do Medusa para
      //                              order.payment_captured)
      await eventBusService.emit([
        { name: "order.placed",               data: { id: order.id } },
        { name: "mercadopago.order_approved", data: { id: order.id } },
      ])
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error("[mercadopago/webhook] erro ao processar notificação:", err)
    // Retornar 200 para evitar retentativas do MP em erros não-recuperáveis
    res.sendStatus(200)
  }
}
