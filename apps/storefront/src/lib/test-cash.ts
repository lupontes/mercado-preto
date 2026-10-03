import { medusaBaseUrl } from '@/lib/medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

/**
 * Asks the backend whether the test-only cash payment is enabled. Any failure
 * means "no": the option must never show up by accident.
 */
export async function fetchTestCashEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${medusaBaseUrl()}/store/checkout/sandbox-cash`, {
      headers: { 'x-publishable-api-key': PUB_KEY },
    })
    if (!res.ok) return false
    const body = await res.json()
    return body?.enabled === true
  } catch {
    return false
  }
}
