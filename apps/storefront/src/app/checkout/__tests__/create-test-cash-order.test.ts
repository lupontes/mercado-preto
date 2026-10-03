import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestCashOrder } from '../create-test-cash-order'

const items = [{ title: 'Camiseta', quantity: 2, price: 7900, variantId: 'var-1', productId: 'prod-1' }]
const address = {
  firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
  document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
  city: 'Cachoeira', state: 'BA',
}
const shipping = { id: 'pac', name: 'PAC', company: 'Correios', price: 2500, currency: 'brl', delivery_time: '5 dias' }

describe('createTestCashOrder', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the same body as the preference request and returns the external reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external_reference: 'ref-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createTestCashOrder(items, address, shipping)

    expect(result).toEqual({ externalReference: 'ref-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/store\/checkout\/test-cash$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ items, address, shipping, total: 2 * 7900 + 2500, document: '111.444.777-35' })
  })

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }))
    expect(await createTestCashOrder(items, address, shipping)).toBeNull()
  })

  it('returns null when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await createTestCashOrder(items, address, shipping)).toBeNull()
  })
})
