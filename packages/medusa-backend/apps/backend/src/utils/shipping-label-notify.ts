import { labelLink } from "./label-token"
import { sendWhatsApp } from "./whatsapp"
import { sendBrevoEmail } from "./email"
import type { ShippingLabelState } from "./shipping-label"

type OrderRef = { id: string; displayId: number }

const dayMonth = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
})

// Sellers think in São Paulo calendar days; formatting in UTC would shift
// late-evening deadlines to the next day.
function formatDayMonth(iso: string): string {
  return dayMonth.format(new Date(iso))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function notifySellerLabelReady(
  seller: { name: string; phone: string; email: string },
  order: OrderRef,
  state: ShippingLabelState
): Promise<void> {
  const link = labelLink(order.id)
  const deadline = state.postBy ? ` até ${formatDayMonth(state.postBy)}` : ""
  const intro = `🛍️ Nova venda no Mercado Preto! Pedido #${order.displayId}.`
  const instruction = `Imprima a etiqueta, cole na caixa e poste nos Correios${deadline}:`
  const text = `${intro}\n\n${instruction}\n${link}\n\n_Mercado Preto_`

  await sendWhatsApp(seller.phone, text)

  const html =
    `<p>Olá, ${escapeHtml(seller.name)}!</p>` +
    `<p>${intro}</p>` +
    `<p>${instruction}<br><a href="${link}">${link}</a></p>` +
    `<p><em>Mercado Preto</em></p>`
  await sendBrevoEmail(seller.email, `Nova venda no Mercado Preto — pedido #${order.displayId}`, html)
}

export async function notifySellerPostingReminder(
  seller: { name: string; phone: string },
  order: OrderRef,
  state: ShippingLabelState
): Promise<void> {
  // The reminder fires on the deadline day, so falling back to today is accurate.
  const date = formatDayMonth(state.postBy ?? new Date().toISOString())
  await sendWhatsApp(
    seller.phone,
    `⏰ Lembrete: o pedido #${order.displayId} precisa ser postado nos Correios até hoje (${date}). Etiqueta: ${labelLink(order.id)}`
  )
}

// BACKEND_URL ends in /api on the server, but the admin SPA lives at /app on the site root.
function adminOrderLink(orderId: string): string | null {
  try {
    return `${new URL(process.env.BACKEND_URL ?? "").origin}/app/orders/${orderId}`
  } catch {
    return null
  }
}

export async function alertTeamLabelFailed(order: OrderRef, state: ShippingLabelState): Promise<void> {
  const reason = state.error ?? "motivo não informado"
  const to = process.env.ADMIN_ALERT_EMAIL
  if (!to) {
    console.error(`[shipping-label] Etiqueta não comprada — pedido #${order.displayId}: ${reason}`)
    return
  }
  const adminLink = adminOrderLink(order.id)
  const html =
    `<p>A etiqueta do pedido #${order.displayId} não foi comprada.</p>` +
    `<p>Motivo: ${escapeHtml(reason)}</p>` +
    (adminLink ? `<p><a href="${adminLink}">${adminLink}</a></p>` : "")
  await sendBrevoEmail(to, `Etiqueta não comprada — pedido #${order.displayId}`, html)
}
