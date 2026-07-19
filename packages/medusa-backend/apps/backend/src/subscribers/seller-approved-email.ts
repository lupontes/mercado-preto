import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"
import { isSandboxMode } from "../utils/sandbox"

async function sendBrevoEmail(to: string, subject: string, htmlContent: string) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return

  let recipient = to
  if (isSandboxMode()) {
    const testRecipient = process.env.TEST_EMAIL_RECIPIENT
    if (!testRecipient) {
      console.error(
        "[sandbox] TEST_EMAIL_RECIPIENT não configurado — e-mail não enviado (destinatário real bloqueado em modo sandbox)"
      )
      return
    }
    recipient = testRecipient
  }

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Mercado Preto", email: process.env.EMAIL_FROM || "noreply@mercadopreto.com.br" },
      to: [{ email: recipient }],
      subject,
      htmlContent,
    }),
  })
}

export default async function sellerApprovedEmail({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const sellerId = event.data.id
  const sellerService: SellerModuleService = container.resolve(SELLER_MODULE)
  const [seller] = await sellerService.listSellers({ id: sellerId })
  if (!seller) return

  const setPasswordUrl = `${process.env.STORE_CORS?.split(",")[0] || "http://localhost:3000"}/vendedor/configurar-senha?email=${encodeURIComponent(seller.email)}`

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
