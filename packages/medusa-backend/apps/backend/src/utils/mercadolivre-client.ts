import { createHmac, timingSafeEqual } from "node:crypto"

const API_BASE = "https://api.mercadolibre.com"
const SITE_ID = "MLB"

export type MLListingFee = { percentageFee: number; fixedFee: number }

export type MLItemInput = {
  title: string
  categoryId: string
  price: number
  currencyId?: string
  availableQuantity: number
  condition?: "new" | "used"
  listingTypeId?: string
  pictures: { source: string }[]
  attributes: { id: string; value_name: string }[]
}

export type MLOrder = {
  id: number
  status: string
  total_amount?: number
  buyer?: { id: number; nickname: string; billing_info?: { doc_number?: string; doc_type?: string } }
  order_items: Array<{ item: { id: string; title: string }; quantity: number; unit_price: number }>
  shipping?: { id: number }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.MERCADOLIVRE_CLIENT_ID ?? "",
      client_secret: process.env.MERCADOLIVRE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Mercado Livre OAuth refresh falhou: ${res.status}`)
  const data = await res.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in }
}

export async function getListingFee(accessToken: string, price: number, categoryId: string): Promise<MLListingFee> {
  const url = `${API_BASE}/sites/${SITE_ID}/listing_prices?price=${price}&category_id=${categoryId}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Mercado Livre listing_prices falhou: ${res.status}`)
  const data = await res.json()
  const details = data.sale_fee_details ?? {}
  return {
    percentageFee: Number(details.percentage_fee ?? 0),
    fixedFee: Number(details.fixed_fee ?? 0),
  }
}

export async function createItem(accessToken: string, item: MLItemInput): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: item.title,
      category_id: item.categoryId,
      price: item.price,
      currency_id: item.currencyId ?? "BRL",
      available_quantity: item.availableQuantity,
      condition: item.condition ?? "new",
      listing_type_id: item.listingTypeId ?? "gold_special",
      pictures: item.pictures,
      attributes: item.attributes,
      shipping: { mode: "me2" },
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Mercado Livre criação de anúncio falhou (${res.status}): ${detail}`)
  }
  const data = await res.json()
  return { id: data.id }
}

export async function getOrder(accessToken: string, orderId: string): Promise<MLOrder> {
  const res = await fetch(`${API_BASE}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Mercado Livre busca de pedido falhou: ${res.status}`)
  return res.json()
}

export function getShipmentLabelUrl(accessToken: string, shipmentId: string): string {
  return `${API_BASE}/shipment_labels?shipment_ids=${shipmentId}&response_type=pdf&access_token=${accessToken}`
}

// Mesmo esquema de assinatura documentado pelo Mercado Pago para seus
// webhooks (header x-signature: "ts=...,v1=...", manifest HMAC-SHA256
// "id:{id};request-id:{x-request-id};ts:{ts};") — confirmar no painel
// Webhooks da aplicação Mercado Livre, ao gerar o secret real, que o
// formato do manifest é idêntico antes de habilitar em produção.
export function verifyWebhookSignature(params: {
  xSignature: string
  xRequestId: string
  dataId: string
  secret: string
}): boolean {
  const { xSignature, xRequestId, dataId, secret } = params
  const parts: Record<string, string> = {}
  for (const part of xSignature.split(",")) {
    const [key, value] = part.trim().split("=")
    if (key && value) parts[key] = value
  }
  const ts = parts.ts
  const receivedHash = parts.v1
  if (!ts || !receivedHash) return false

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const expectedHash = createHmac("sha256", secret).update(manifest).digest("hex")

  const expectedBuf = Buffer.from(expectedHash, "hex")
  const receivedBuf = Buffer.from(receivedHash, "hex")
  if (expectedBuf.length !== receivedBuf.length) return false
  return timingSafeEqual(expectedBuf, receivedBuf)
}
