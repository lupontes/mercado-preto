import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function verifySecret(req: MedusaRequest, secret: string): boolean {
  const incoming = req.headers["x-clearsale-secret"] as string | undefined
  if (!incoming) return false

  const incomingBuf = Buffer.from(incoming)
  const secretBuf = Buffer.from(secret)
  if (incomingBuf.length !== secretBuf.length) return false

  return crypto.timingSafeEqual(incomingBuf, secretBuf)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // validateEnv() (src/utils/validate-env.ts) guarantees this is always set at boot.
  const secret = process.env.CLEARSALE_WEBHOOK_SECRET!
  if (!verifySecret(req, secret)) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const { order_id, status, score } = req.body as any

  if (!order_id) {
    return res.status(400).json({ error: "order_id obrigatório" })
  }

  const orderService = req.scope.resolve(Modules.ORDER)
  const eventBus = req.scope.resolve(Modules.EVENT_BUS)

  const order = await orderService.retrieveOrder(order_id).catch(() => null)
  if (!order) {
    return res.status(404).json({ error: "Pedido não encontrado" })
  }

  if (status === "APA" || status === "APM") {
    await eventBus.emit({
      name: "order.clearsale.approved",
      data: { id: order_id, score },
    })
    return res.json({ message: "Pedido aprovado pelo antifraude" })
  }

  if (status === "RPM" || status === "RPA" || status === "CAN") {
    await orderService.cancel(order_id)
    await eventBus.emit({
      name: "order.clearsale.rejected",
      data: { id: order_id, score, status },
    })
    return res.json({ message: "Pedido cancelado pelo antifraude" })
  }

  res.json({ message: "Evento recebido", status })
}
