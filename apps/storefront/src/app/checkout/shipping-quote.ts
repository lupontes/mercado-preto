import type { ShippingQuote } from '@/lib/cart-store'
import { medusaBaseUrl } from '@/lib/medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

/** The backend refused the quote and told the buyer why (e.g. a product left the store). */
export class ShippingQuoteRejected extends Error {}

const CONNECTION_HINT = 'Não foi possível calcular o frete. Verifique sua conexão e tente novamente.'

/** Buyer-facing text for a failed quote: the backend's reason when it gave one. */
export function shippingQuoteErrorMessage(err: unknown): string {
  return err instanceof ShippingQuoteRejected ? err.message : CONNECTION_HINT
}

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
    if (typeof body?.error === 'string' && body.error) throw new ShippingQuoteRejected(body.error)
    throw new Error('Não foi possível calcular o frete.')
  }
  return res.json()
}
