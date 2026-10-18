import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreference, readCheckoutResponse } from '../create-preference'

const items = [{ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' }]
const address = {
  firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
  document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
  city: 'Cachoeira', state: 'BA',
}
const shipping = { tier: 'economico' as const, label: 'Econômico', total: 2500, deliveryDays: 11, sellers: [] }

describe('createPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the preference on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ preference_id: 'pref-1', external_reference: 'ref-1', total: 10400 }),
    }))

    expect(await createPreference(items, address, shipping)).toEqual({
      ok: true, data: { preferenceId: 'pref-1', externalReference: 'ref-1', totalCents: 10400 },
    })
  })

  it('fails instead of handing the Brick an undefined amount when an older backend omits the total', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ preference_id: 'pref-1', external_reference: 'ref-1' }),
    }))

    expect(await createPreference(items, address, shipping)).toEqual({
      ok: false, status: 200, error: 'Erro ao preparar o pagamento.',
    })
  })

  it('turns a network failure into a failed result instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect(await createPreference(items, address, shipping)).toEqual({
      ok: false, status: 0, error: 'Erro ao preparar o pagamento.',
    })
  })
})

describe('readCheckoutResponse', () => {
  it('carries priceChanges from a price 409 and leaves quote empty', async () => {
    const priceChanges = [{ variantId: 'var-1', price: 8500, title: 'Camiseta' }]
    const res = { ok: false, status: 409, json: async () => ({ error: 'O preço de alguns produtos foi atualizado', priceChanges }) } as Response

    expect(await readCheckoutResponse(res, (b) => b)).toEqual({
      ok: false, status: 409, error: 'O preço de alguns produtos foi atualizado', quote: undefined, priceChanges,
    })
  })

  it('sends the points to use and reads back what the server applied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ preference_id: 'p', external_reference: 'r', total: 10100, pointsApplied: 300, discount: 300 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPreference(items, address, shipping, { redeemPoints: 300, loyaltyToken: 'tok' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ redeemPoints: 300, loyaltyToken: 'tok' })
    expect(result).toEqual({ ok: true, data: { preferenceId: 'p', externalReference: 'r', totalCents: 10100, discountCents: 300 } })
  })
})
