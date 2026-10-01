import type { ShippingRate } from '@/lib/cart-store'
import { medusaBaseUrl } from '@/lib/medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function fetchShippingRates(cep: string): Promise<ShippingRate[]> {
  const res = await fetch(`${medusaBaseUrl()}/store/shipping/estimate?cep=${cep}`, {
    headers: { 'x-publishable-api-key': PUB_KEY },
  })
  if (!res.ok) return []
  const { rates } = await res.json()
  return rates ?? []
}
