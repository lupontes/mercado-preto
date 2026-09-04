import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../../../modules/marketplace-channel/service"
import { getOrder, verifyWebhookSignature } from "../../../utils/mercadolivre-client"

type MLWebhookBody = {
  topic?: string
  resource?: string
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")
  const body = req.body as MLWebhookBody

  if (body.topic !== "orders_v2" || !body.resource) {
    return res.sendStatus(200)
  }

  const orderId = body.resource.split("/").pop()
  if (!orderId) return res.sendStatus(200)

  const xSignature = (req.headers["x-signature"] as string) ?? ""
  const xRequestId = (req.headers["x-request-id"] as string) ?? ""
  const isValid = verifyWebhookSignature({
    xSignature,
    xRequestId,
    dataId: orderId,
    secret: process.env.MERCADOLIVRE_WEBHOOK_SECRET ?? "",
  })
  if (!isValid) {
    logger.error(`[mercadolivre/webhook] assinatura inválida para o pedido ${orderId} — notificação ignorada`)
    return res.sendStatus(200)
  }

  try {
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
    const listing = firstItemId ? await channelService.findListingByExternalItemId(firstItemId) : null
    if (!listing) {
      logger.error(`[mercadolivre/webhook] anúncio ${firstItemId} não encontrado nos registros locais — pedido ${mlOrder.id} não criado`)
      return res.sendStatus(200)
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
        metadata: {
          channel: "mercado_livre",
          mercadolivre_order_id: String(mlOrder.id),
          mercadolivre_item_id: firstItemId,
          seller_id: listing.sellerId,
          buyer_document: mlOrder.buyer?.billing_info?.doc_number ?? null,
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
