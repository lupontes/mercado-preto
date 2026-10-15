import type { ShippingQuote } from '@/lib/cart-store'
import { medusaBaseUrl } from '@/lib/medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function fetchShippingQuote(
  postalCode: string,
  items: Array<{ variantId: string; quantity: number }>
): Promise<ShippingQuote> {
  const res = await fetch(`${medusaBaseUrl()}/store/shipping/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ postalCode, items }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Não foi possível calcular o frete.')
  }
  return res.json()
}
