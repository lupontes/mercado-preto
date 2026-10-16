import type { ShippingOption, ShippingQuote } from '@/lib/cart-store'
import { medusaBaseUrl } from '@/lib/medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export type Address = {
  firstName: string
  lastName: string
  email: string
  phone: string
  document: string
  cep: string
  address1: string
  address2: string
  city: string
  state: string
}

export type PreferenceData = {
  preferenceId: string
  externalReference: string
}

export type CheckoutItem = {
  title: string
  quantity: number
  price: number
  variantId: string
  productId: string
}

export type CheckoutResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; quote?: ShippingQuote }

// Shared by every checkout submission so the backend receives the same shape
// regardless of payment method. Only the tier and the total the buyer saw are
// sent: the backend re-quotes and rejects with 409 if the price moved.
export function buildCheckoutRequestBody(items: CheckoutItem[], address: Address, shipping: ShippingOption) {
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0) + shipping.total
  return { items, address, shipping: { tier: shipping.tier, expectedTotal: shipping.total }, total, document: address.document }
}

/** Shared by every checkout POST: maps 409/422 bodies into a typed failure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readCheckoutResponse<T>(res: Response, pick: (body: any) => T): Promise<CheckoutResult<T>> {
  const body = await res.json().catch(() => null)
  // A 2xx with an unreadable body must not look like a successful checkout.
  if (res.ok && body === null) return { ok: false, status: res.status, error: 'Erro ao preparar o pagamento.' }
  if (res.ok) return { ok: true, data: pick(body) }
  return { ok: false, status: res.status, error: body?.error ?? 'Erro ao preparar o pagamento.', quote: body?.quote }
}

export async function createPreference(
  items: CheckoutItem[],
  address: Address,
  shipping: ShippingOption
): Promise<CheckoutResult<PreferenceData>> {
  // A dropped request rejects instead of resolving; without this the
  // shipping step would keep spinning forever.
  try {
    const res = await fetch(`${medusaBaseUrl()}/store/checkout/preference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': PUB_KEY,
      },
      body: JSON.stringify(buildCheckoutRequestBody(items, address, shipping)),
    })
    return await readCheckoutResponse(res, (b) => ({ preferenceId: b.preference_id, externalReference: b.external_reference }))
  } catch {
    return { ok: false, status: 0, error: 'Erro ao preparar o pagamento.' }
  }
}
