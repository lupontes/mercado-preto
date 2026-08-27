import type { ShippingRate } from '@/lib/cart-store'

const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
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

export async function createPreference(
  items: { title: string; quantity: number; price: number; variantId?: string; productId: string }[],
  address: Address,
  shipping: ShippingRate
): Promise<PreferenceData | null> {
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0) + shipping.price

  const res = await fetch(`${MEDUSA_URL}/store/checkout/preference`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
    body: JSON.stringify({ items, address, shipping, total, document: address.document }),
  })

  if (!res.ok) return null
  const { preference_id, external_reference } = await res.json()
  return { preferenceId: preference_id, externalReference: external_reference }
}
