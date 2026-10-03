// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPreference } from '../create-preference'
import { fetchShippingRates } from '../shipping-rates'
import { submitPayment } from '@/components/payment/MercadoPagoBrick'

// The test server serves the storefront over https while NEXT_PUBLIC_MEDUSA_URL
// is plain http, so any browser call to that absolute URL is blocked as mixed
// content before reaching the network. Checkout calls must stay relative.
const INSECURE_BACKEND = 'http://168.138.148.67:9000'

const RATE = { id: 'pac', name: 'PAC', company: 'Correios', price: 2500, currency: 'brl', delivery_time: '5 dias' }
const ADDRESS = {
  firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
  document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
  city: 'Cachoeira', state: 'BA',
}

describe('checkout calls in the browser', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MEDUSA_URL', INSECURE_BACKEND)
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: [] }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('fetchShippingRates uses a relative URL', async () => {
    await fetchShippingRates('44300000')

    expect(fetchMock.mock.calls[0][0]).toBe('/store/shipping/estimate?cep=44300000')
  })

  it('createPreference uses a relative URL', async () => {
    await createPreference([{ title: 'Camiseta', quantity: 1, price: 7900, productId: 'prod-1' }], ADDRESS, RATE)

    expect(fetchMock.mock.calls[0][0]).toBe('/store/checkout/preference')
  })

  it('submitPayment uses a relative URL', async () => {
    await submitPayment({}, 'ref-1', 10400)

    expect(fetchMock.mock.calls[0][0]).toBe('/store/checkout/payment')
  })
})
