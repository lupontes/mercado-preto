import type { ShippingRate } from '@/lib/cart-store'
import { buildCheckoutRequestBody, type Address, type CheckoutItem } from './create-preference'

const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function createTestCashOrder(
  items: CheckoutItem[],
  address: Address,
  shipping: ShippingRate
): Promise<{ externalReference: string } | null> {
  try {
    const res = await fetch(`${MEDUSA_URL}/store/checkout/test-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': PUB_KEY,
      },
      body: JSON.stringify(buildCheckoutRequestBody(items, address, shipping)),
    })
    if (!res.ok) return null
    const { external_reference } = await res.json()
    return { externalReference: external_reference }
  } catch {
    return null
  }
}
