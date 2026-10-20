import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getLabelClient } from "./melhor-envio-labels"
import type { ShippingLabelState } from "./shipping-label"

export const LABEL_NOT_FOUND = "Etiqueta não encontrada ou expirada."

// Medusa only returns metadata when it is selected explicitly.
export const LABEL_ORDER_SELECT = ["id", "metadata"]

export function notFound(res: MedusaResponse) {
  return res.status(404).send(LABEL_NOT_FOUND)
}

// Melhor Envio print URLs expire, so each request asks for a fresh one. Every
// failure collapses into the same 404 so nothing about the provider leaks.
export async function redirectToPrint(req: MedusaRequest, res: MedusaResponse, order: any) {
  const label = order?.metadata?.shipping_label as ShippingLabelState | undefined
  if (label?.status !== "generated" || !label.meOrderIds?.length) return notFound(res)

  const client = getLabelClient()
  if (!client) return notFound(res)

  try {
    const url = await client.printUrl(label.meOrderIds)
    return res.redirect(302, url)
  } catch (error) {
    req.scope.resolve("logger").error(`Falha ao gerar a URL de impressão da etiqueta: ${(error as Error).message}`)
    return notFound(res)
  }
}
