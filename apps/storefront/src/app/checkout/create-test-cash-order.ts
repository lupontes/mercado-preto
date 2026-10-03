import type { ShippingRate } from '@/lib/cart-store'
import { buildCheckoutRequestBody, type Address, type CheckoutItem } from './create-preference'

// In the browser, a direct call to NEXT_PUBLIC_MEDUSA_URL (http://) from an
// https page is blocked as mixed content. Server-side (SSR) is unaffected and
// uses the backend URL directly; client-side uses a relative path, resolved
// against the page's own https origin and proxied by nginx (location /store/).
const BASE_URL = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000')
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function createTestCashOrder(
  items: CheckoutItem[],
  address: Address,
  shipping: ShippingRate
): Promise<{ externalReference: string } | null> {
  try {
    const res = await fetch(`${BASE_URL}/store/checkout/test-cash`, {
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
