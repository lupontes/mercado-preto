import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../../../modules/marketplace-channel/service"
import { getOrder, verifyWebhookSignature, getShipment, getBillingInfo } from "../../../utils/mercadolivre-client"

type MLWebhookBody = {
  topic?: string
  resource?: string
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")

  // Todo o corpo do handler roda dentro deste try — inclusive o parsing do
  // payload e a checagem de assinatura — porque um payload malformado
  // (ex.: "resource" não-string, corpo vazio) não pode escapar como exceção
  // não tratada: o Mercado Livre reenvia indefinidamente um webhook que não
  // responde 200, e essa é justamente a garantia que este handler precisa dar
  // mesmo diante de entrada inesperada, não só de erros de rede/API.
  try {
    const body = req.body as MLWebhookBody | undefined

    if (body?.topic !== "orders_v2" || typeof body?.resource !== "string") {
      return res.sendStatus(200)
    }

    const orderId = body.resource.split("/").pop()
    if (!orderId) return res.sendStatus(200)

    const webhookSecret = process.env.MERCADOLIVRE_WEBHOOK_SECRET
    if (!webhookSecret) {
      logger.error("[mercadolivre/webhook] MERCADOLIVRE_WEBHOOK_SECRET não configurado — webhook rejeitado")
      return res.status(500).json({ error: "Webhook secret not configured" })
    }

    const xSignature = (req.headers["x-signature"] as string) ?? ""
    const xRequestId = (req.headers["x-request-id"] as string) ?? ""
    const isValid = verifyWebhookSignature({
      xSignature,
      xRequestId,
      dataId: orderId,
      secret: webhookSecret,
    })
    if (!isValid) {
      logger.error(`[mercadolivre/webhook] assinatura inválida para o pedido ${orderId} — notificação ignorada`)
      return res.sendStatus(200)
    }

    const channelService: MarketplaceChannelModuleService = req.scope.resolve(MARKETPLACE_CHANNEL_MODULE)
    const credential = await channelService.getCredential("mercado_livre")
    if (!credential) {
      logger.error("[mercadolivre/webhook] credencial não configurada, pedido não processado")
      return res.sendStatus(200)
    }

    const mlOrder = await getOrder(credential.accessToken, orderId)
    if (mlOrder.status !== "paid") {
      return res.sendStatus(200)
    }

    const orderService = req.scope.resolve(Modules.ORDER)
    const eventBusService = req.scope.resolve(Modules.EVENT_BUS)

    const existing = await orderService.listOrders(
      { metadata: { mercadolivre_order_id: String(mlOrder.id) } } as any,
      { take: 1 }
    )
    if (existing.length > 0) {
      logger.info(`[mercadolivre/webhook] pedido ${mlOrder.id} já processado — ignorando`)
      return res.sendStatus(200)
    }

    const firstItemId = mlOrder.order_items[0]?.item.id
    if (mlOrder.order_items.length > 1) {
      logger.warn(`[mercadolivre/webhook] pedido ${mlOrder.id} tem ${mlOrder.order_items.length} itens — comissão/vendedor atribuídos apenas ao primeiro item`)
    }
    const listing = firstItemId ? await channelService.findListingByExternalItemId(firstItemId) : null
    if (!listing) {
      logger.error(`[mercadolivre/webhook] anúncio ${firstItemId} não encontrado nos registros locais — pedido ${mlOrder.id} não criado`)
      return res.sendStatus(200)
    }

    // Dados fiscais e endereço reais são melhor-esforço: se a busca falhar,
    // o pedido ainda é criado (não perdemos um pedido pago por causa de uma
    // chamada secundária) e os fallbacks de order-fiscal-emit.ts entram em
    // ação como acontecia antes desta busca existir.
    let buyerDocument: string | null = null
    let buyerFirstName: string | undefined
    let buyerLastName: string | undefined
    if (mlOrder.buyer?.billing_info?.id) {
      try {
        const billing = await getBillingInfo(credential.accessToken, mlOrder.buyer.billing_info.id)
        buyerDocument = billing.docNumber || null
        buyerFirstName = billing.name || undefined
        buyerLastName = billing.lastName || undefined
      } catch (err) {
        logger.warn(`[mercadolivre/webhook] falha ao buscar dados fiscais do pedido ${mlOrder.id}: ${err}`)
      }
    }

    let shippingAddress: Record<string, unknown> | undefined
    if (mlOrder.shipping?.id) {
      try {
        const shipment = await getShipment(credential.accessToken, String(mlOrder.shipping.id))
        // O ML não expõe um nome de destinatário separado do envio — reaproveita
        // o nome do faturamento (ou o nickname, se não houver dados fiscais) como
        // first_name/last_name do shipping_address.
        shippingAddress = {
          first_name: buyerFirstName ?? mlOrder.buyer?.nickname ?? "Comprador",
          last_name: buyerLastName ?? "",
          address_1: shipment.addressLine,
          city: shipment.cityName,
          province: shipment.stateCode,
          postal_code: shipment.zipCode,
          country_code: "br",
        }
      } catch (err) {
        logger.warn(`[mercadolivre/webhook] falha ao buscar endereço de envio do pedido ${mlOrder.id}: ${err}`)
      }
    }

    const [order] = await orderService.createOrders([
      {
        currency_code: "brl",
        email: `${mlOrder.buyer?.nickname ?? "comprador"}@mercadolivre.com.br`,
        items: mlOrder.order_items.map((i) => ({
          title: i.item.title,
          quantity: i.quantity,
          unit_price: Math.round(i.unit_price * 100),
        })),
        ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
        metadata: {
          channel: "mercado_livre",
          mercadolivre_order_id: String(mlOrder.id),
          mercadolivre_item_id: firstItemId,
          mercadolivre_shipment_id: mlOrder.shipping?.id ?? null,
          seller_id: listing.sellerId,
          buyer_document: buyerDocument,
        },
      },
    ])

    logger.info(`[mercadolivre/webhook] pedido criado: ${order.id}`)

    await eventBusService.emit([{ name: "marketplace.order_placed", data: { id: order.id } }])
  } catch (err) {
    logger.error("[mercadolivre/webhook] erro ao processar notificação:", err)
  }

  res.sendStatus(200)
}
