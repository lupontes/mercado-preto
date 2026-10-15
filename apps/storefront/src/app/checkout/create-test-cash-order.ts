import type { ShippingOption } from '@/lib/cart-store'
import {
  buildCheckoutRequestBody,
  readCheckoutResponse,
  type Address,
  type CheckoutItem,
  type CheckoutResult,
} from './create-preference'
import { medusaBaseUrl } from '@/lib/medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function createTestCashOrder(
  items: CheckoutItem[],
  address: Address,
  shipping: ShippingOption
): Promise<CheckoutResult<{ externalReference: string }>> {
  try {
    const res = await fetch(`${medusaBaseUrl()}/store/checkout/sandbox-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': PUB_KEY,
      },
      body: JSON.stringify(buildCheckoutRequestBody(items, address, shipping)),
    })
    return await readCheckoutResponse(res, (b) => ({ externalReference: b.external_reference }))
  } catch {
    return { ok: false, status: 0, error: 'Erro ao criar o pedido de teste.' }
  }
}
