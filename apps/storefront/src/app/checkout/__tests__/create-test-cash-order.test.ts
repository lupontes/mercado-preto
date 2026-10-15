import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestCashOrder } from '../create-test-cash-order'

const items = [{ title: 'Camiseta', quantity: 2, price: 7900, variantId: 'var-1', productId: 'prod-1' }]
const address = {
  firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
  document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
  city: 'Cachoeira', state: 'BA',
}
const shipping = { tier: 'economico' as const, label: 'Econômico', total: 2500, deliveryDays: 11, sellers: [] }

describe('createTestCashOrder', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the same body as the preference request and returns the external reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external_reference: 'ref-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createTestCashOrder(items, address, shipping)

    expect(result).toEqual({ ok: true, data: { externalReference: 'ref-1' } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/store\/checkout\/sandbox-cash$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ items, address, shipping: { tier: 'economico', expectedTotal: 2500 }, total: 2 * 7900 + 2500, document: '111.444.777-35' })
  })

  it('uses a same-origin relative URL in the browser to avoid mixed content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external_reference: 'ref-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {})
    // BASE_URL is resolved at module load, so re-import with window defined.
    vi.resetModules()
    const { createTestCashOrder: fn } = await import('../create-test-cash-order')

    await fn(items, address, shipping)

    expect(fetchMock.mock.calls[0][0]).toBe('/store/checkout/sandbox-cash')
  })

  it('returns a typed failure with the backend error and quote on 409', async () => {
    const quote = { options: [], unavailableSellers: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'O valor do frete foi atualizado', quote }) }))
    expect(await createTestCashOrder(items, address, shipping)).toEqual({
      ok: false, status: 409, error: 'O valor do frete foi atualizado', quote,
    })
  })

  it('returns a status 0 failure when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await createTestCashOrder(items, address, shipping)).toEqual({
      ok: false, status: 0, error: 'Erro ao criar o pedido de teste.',
    })
  })
})
