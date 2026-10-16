// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPreference } from '../create-preference'
import { fetchShippingQuote } from '../shipping-quote'
import { submitPayment } from '@/components/payment/MercadoPagoBrick'

// The test server serves the storefront over https while NEXT_PUBLIC_MEDUSA_URL
// is plain http, so any browser call to that absolute URL is blocked as mixed
// content before reaching the network. Checkout calls must stay relative.
const INSECURE_BACKEND = 'http://168.138.148.67:9000'

const OPTION = { tier: 'economico' as const, label: 'Econômico', total: 2500, deliveryDays: 11, sellers: [] }
const ADDRESS = {
  firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
  document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
  city: 'Cachoeira', state: 'BA',
}

describe('checkout calls in the browser', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MEDUSA_URL', INSECURE_BACKEND)
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options: [], unavailableSellers: [] }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('fetchShippingQuote uses a relative URL', async () => {
    await fetchShippingQuote('44300000', [{ variantId: 'var-1', quantity: 1 }])

    expect(fetchMock.mock.calls[0][0]).toBe('/store/shipping/quote')
  })

  it('createPreference uses a relative URL', async () => {
    await createPreference([{ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' }], ADDRESS, OPTION)

    expect(fetchMock.mock.calls[0][0]).toBe('/store/checkout/preference')
  })

  it('submitPayment uses a relative URL', async () => {
    await submitPayment({}, 'ref-1', 10400)

    expect(fetchMock.mock.calls[0][0]).toBe('/store/checkout/payment')
  })
})
