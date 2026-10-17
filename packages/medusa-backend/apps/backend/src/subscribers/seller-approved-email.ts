import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService, { SETUP_TOKEN_TTL_MS } from "../modules/seller/service"
import { sendBrevoEmail } from "../utils/email"
import { sellerPasswordLink } from "../utils/seller-password-link"

export default async function sellerApprovedEmail({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const sellerId = event.data.id
  const sellerService: SellerModuleService = container.resolve(SELLER_MODULE)
  const [seller] = await sellerService.listSellers({ id: sellerId })
  if (!seller) return

  // The link carries a one-time token: knowing the seller's e-mail must never be
  // enough to set their password.
  const token = await sellerService.issuePasswordToken(seller.id, SETUP_TOKEN_TTL_MS)
  const setPasswordUrl = sellerPasswordLink(token)

  await sendBrevoEmail(
    seller.email,
    "Sua loja no Mercado Preto foi aprovada!",
    `
    <h2>Parabéns, ${seller.ownerName}!</h2>
    <p>Sua loja <strong>${seller.name}</strong> foi aprovada e já está no Mercado Preto.</p>
    <p>Para acessar o portal do vendedor e começar a cadastrar seus produtos, configure sua senha:</p>
    <p><a href="${setPasswordUrl}" style="background:#D4A017;color:#1A1A1A;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Configurar minha senha</a></p>
    <p>Em caso de dúvidas, entre em contato conosco pelo WhatsApp ou e-mail.</p>
    <p>Com axé,<br>Equipe Mercado Preto — Mulheres de Axé do Brasil</p>
    `
  )
}

export const config: SubscriberConfig = {
  event: "seller.approved",
}
