import { sendWhatsApp } from "./whatsapp"
import { sendBrevoEmail } from "./email"

export type ModerationKind = "new" | "change"
export type ProductRef = { id: string; title: string; handle: string }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// BACKEND_URL ends in /api on the server, but the admin SPA (/app) and the
// storefront (/produto) live at the site root.
function siteOrigin(): string | null {
  try {
    return new URL(process.env.BACKEND_URL ?? "").origin
  } catch {
    return null
  }
}

export function adminProductLink(productId: string): string | null {
  const origin = siteOrigin()
  return origin ? `${origin}/app/products/${productId}` : null
}

export function storeProductLink(handle: string): string | null {
  const origin = siteOrigin()
  return origin ? `${origin}/produto/${handle}` : null
}

export async function notifyTeamProductSubmitted(
  product: ProductRef,
  sellerName: string,
  kind: ModerationKind
): Promise<void> {
  const headline =
    kind === "new"
      ? `Novo produto da loja ${sellerName} aguardando análise: ${product.title}`
      : `Alteração de produto da loja ${sellerName} aguardando análise: ${product.title}`
  const link = adminProductLink(product.id)

  const to = process.env.ADMIN_ALERT_EMAIL
  if (!to) {
    console.error(`[product-moderation] ${headline}`)
  } else {
    const html = `<p>${escapeHtml(headline)}</p>` + (link ? `<p><a href="${link}">${link}</a></p>` : "")
    await sendBrevoEmail(to, `Produto para analisar — ${product.title}`, html)
  }

  const teamPhone = process.env.MODERATION_ALERT_WHATSAPP
  if (teamPhone) {
    await sendWhatsApp(teamPhone, link ? `${headline}\n${link}` : headline)
  }
}

export async function notifySellerProductApproved(
  seller: { name: string; phone: string; email: string },
  product: ProductRef,
  kind: ModerationKind
): Promise<void> {
  const link = storeProductLink(product.handle) ?? ""
  const text =
    kind === "new"
      ? `✅ Seu produto *${product.title}* foi aprovado e já está à venda no Mercado Preto:\n${link}\n\n_Mercado Preto_`
      : `✅ A alteração do produto *${product.title}* foi aprovada e já está na vitrine do Mercado Preto:\n${link}\n\n_Mercado Preto_`

  await sendWhatsApp(seller.phone, text)

  const intro =
    kind === "new"
      ? `✅ Seu produto <strong>${escapeHtml(product.title)}</strong> foi aprovado e já está à venda no Mercado Preto:`
      : `✅ A alteração do produto <strong>${escapeHtml(product.title)}</strong> foi aprovada e já está na vitrine do Mercado Preto:`
  const html =
    `<p>Olá, ${escapeHtml(seller.name)}!</p>` +
    `<p>${intro}<br>${link ? `<a href="${link}">${link}</a>` : ""}</p>` +
    `<p><em>Mercado Preto</em></p>`
  await sendBrevoEmail(seller.email, `Produto aprovado no Mercado Preto — ${product.title}`, html)
}
