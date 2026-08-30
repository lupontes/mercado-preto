// apps/storefront/src/app/checkout/__tests__/page.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreference } from '../create-preference'

describe('createPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes productId for each item in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ preference_id: 'pref-1', external_reference: 'ref-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createPreference(
      [{ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' }],
      {
        firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
        document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
        city: 'Cachoeira', state: 'BA',
      },
      { id: 'pac', name: 'PAC', company: 'Correios', price: 2500, currency: 'brl', delivery_time: '5 dias' }
    )

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse((init as RequestInit).body as string)
    expect(sentBody.items[0]).toEqual(
      expect.objectContaining({ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' })
    )
  })
})
