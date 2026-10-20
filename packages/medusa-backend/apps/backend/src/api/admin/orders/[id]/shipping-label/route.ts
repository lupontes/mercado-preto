import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../../modules/seller"
import { purchaseShippingLabel, type ShippingLabelState } from "../../../../../utils/shipping-label"
import { getLabelClient } from "../../../../../utils/melhor-envio-labels"
import { getShippingCalculator } from "../../../../../utils/melhor-envio"
import { notifySellerLabelReady } from "../../../../../utils/shipping-label-notify"
import { labelLink } from "../../../../../utils/label-token"

// Beyond this a `pending` label is a purchase whose process died, not one in flight.
const STALE_PENDING_MS = 15 * 60 * 1000

async function loadOrder(req: MedusaRequest) {
  const orderService: any = req.scope.resolve(Modules.ORDER)
  // "metadata"/"display_id" must be in select or Medusa leaves them out.
  const order = await orderService.retrieveOrder(req.params.id, { select: ["metadata", "display_id"] })
  const metadata = order?.metadata ?? {}
  return { orderService, order, metadata, state: metadata.shipping_label as ShippingLabelState | undefined }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { state } = await loadOrder(req)
  res.json({ shipping_label: state ?? null, link: state?.status === "generated" ? labelLink(req.params.id) : null })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { orderService, order, metadata, state } = await loadOrder(req)
  if (!state) return res.status(409).json({ error: "Este pedido não tem etiqueta para comprar" })

  const stale =
    state.status === "pending" &&
    !!state.pendingSince &&
    Date.now() - new Date(state.pendingSince).getTime() > STALE_PENDING_MS
  if (state.status !== "failed" && !stale) {
    return res.status(409).json({ error: "A etiqueta só pode ser comprada de novo quando a compra falhou" })
  }

  const labels = getLabelClient()
  const calculator = getShippingCalculator()
  if (!labels || !calculator) return res.status(503).json({ error: "Melhor Envio não configurado" })

  if (stale) {
    // Medusa replaces metadata wholesale, so the full object goes back. Keeping
    // ids/paid/price lets the purchase resume without paying twice.
    await orderService.updateOrders(req.params.id, {
      metadata: {
        ...metadata,
        shipping_label: {
          ...state,
          status: "failed",
          pendingSince: null,
          error: "Compra interrompida; retomada pelo painel",
        },
      },
    })
  }

  const sellerService: any = req.scope.resolve(SELLER_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const result = await purchaseShippingLabel({ orderService, sellerService, labels, calculator, query }, req.params.id)

  if (result.status === "generated") {
    try {
      const seller = await sellerService.retrieveSeller(metadata.seller_id)
      await notifySellerLabelReady(seller, { id: req.params.id, displayId: order.display_id }, result)
    } catch (err) {
      // The label is already bought and saved; a failed notice must not hide that.
      req.scope.resolve("logger").error(`[admin-shipping-label] notify failed for ${req.params.id}: ${(err as Error).message}`)
    }
  }
  res.json({ shipping_label: result })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { orderService, metadata, state } = await loadOrder(req)
  if (state?.status !== "generated") {
    return res.status(409).json({ error: "Só é possível cancelar uma etiqueta gerada" })
  }
  if (metadata.shipping_status !== "awaiting_shipment") {
    return res.status(409).json({ error: "Etiqueta já postada" })
  }

  const labels = getLabelClient()
  if (!labels) return res.status(503).json({ error: "Melhor Envio não configurado" })

  try {
    for (const id of state.meOrderIds) await labels.cancel(id)
  } catch (err) {
    return res.status(502).json({ error: `Não foi possível cancelar no Melhor Envio: ${(err as Error).message}` })
  }

  const canceled: ShippingLabelState = { ...state, status: "canceled" }
  await orderService.updateOrders(req.params.id, { metadata: { ...metadata, shipping_label: canceled } })
  res.json({ shipping_label: canceled })
}
