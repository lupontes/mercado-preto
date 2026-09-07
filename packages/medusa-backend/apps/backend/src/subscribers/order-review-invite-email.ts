import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { createReviewToken } from "../utils/review-jwt"
import { sendBrevoEmail } from "../utils/email"

export default async function orderReviewInviteEmail({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(event.data.id, {
    select: ["email", "display_id", "metadata"],
  })
  if (!order) return

  const email = (order as any).email
  if (!email) return

  // Orders created before the multi-seller order-split feature landed have
  // no seller_id in their metadata — POST /store/reviews can't accept a
  // review for them, so don't invite a review the buyer could never submit.
  if (!(order.metadata as any)?.seller_id) return

  const token = createReviewToken(order.id)
  const baseUrl = process.env.STORE_CORS?.split(",")[0] || "http://localhost:3000"
  const reviewUrl = `${baseUrl}/avaliar/${token}`

  await sendBrevoEmail(
    email,
    "O que você achou da sua compra no Mercado Preto?",
    `
    <h2>Seu pedido #${(order as any).display_id} foi entregue!</h2>
    <p>Sua opinião ajuda outros compradores e fortalece o artesanato afrobrasileiro.</p>
    <p><a href="${reviewUrl}" style="background:#D4A017;color:#1A1A1A;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Avaliar meus produtos</a></p>
    <p>Com axé,<br>Equipe Mercado Preto — Mulheres de Axé do Brasil</p>
    `
  )
}

export const config: SubscriberConfig = {
  event: "order.completed",
}
