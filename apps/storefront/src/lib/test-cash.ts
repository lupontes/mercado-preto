// In the browser, a direct call to NEXT_PUBLIC_MEDUSA_URL (http://) from an
// https page is blocked as mixed content. Server-side (SSR) is unaffected and
// uses the backend URL directly; client-side uses a relative path, resolved
// against the page's own https origin and proxied by nginx (location /store/).
const BASE_URL = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000')
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

/**
 * Asks the backend whether the test-only cash payment is enabled. Any failure
 * means "no": the option must never show up by accident.
 */
export async function fetchTestCashEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/store/checkout/test-cash`, {
      headers: { 'x-publishable-api-key': PUB_KEY },
    })
    if (!res.ok) return false
    const body = await res.json()
    return body?.enabled === true
  } catch {
    return false
  }
}
