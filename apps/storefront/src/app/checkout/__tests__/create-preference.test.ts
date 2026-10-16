import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreference } from '../create-preference'

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
      ok: true, status: 200, json: async () => ({ preference_id: 'pref-1', external_reference: 'ref-1' }),
    }))

    expect(await createPreference(items, address, shipping)).toEqual({
      ok: true, data: { preferenceId: 'pref-1', externalReference: 'ref-1' },
    })
  })

  it('turns a network failure into a failed result instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect(await createPreference(items, address, shipping)).toEqual({
      ok: false, status: 0, error: 'Erro ao preparar o pagamento.',
    })
  })
})
