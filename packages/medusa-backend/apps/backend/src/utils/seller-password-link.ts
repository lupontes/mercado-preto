import { sendBrevoEmail } from "./email"

export function sellerPasswordLink(rawToken: string, env: NodeJS.ProcessEnv = process.env): string {
  const storefront = env.STORE_CORS?.split(",")[0]?.trim() || "http://localhost:3000"
  return `${storefront}/vendedor/configurar-senha?token=${encodeURIComponent(rawToken)}`
}

export async function sendSellerPasswordResetEmail(
  seller: { email: string; ownerName: string },
  link: string
): Promise<void> {
  await sendBrevoEmail(
    seller.email,
    "Redefinir sua senha no Mercado Preto",
    `
    <h2>Olá, ${seller.ownerName}!</h2>
    <p>Recebemos um pedido para redefinir a senha do seu portal do vendedor.</p>
    <p><a href="${link}" style="background:#D4A017;color:#1A1A1A;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Redefinir minha senha</a></p>
    <p>O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail.</p>
    <p>Com axé,<br>Equipe Mercado Preto — Mulheres de Axé do Brasil</p>
    `
  )
}
