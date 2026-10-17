// apps/storefront/src/app/checkout/__tests__/page.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreference } from '../create-preference'

const items = [{ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' }]
const address = {
  firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
  document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
  city: 'Cachoeira', state: 'BA',
}
const option = { tier: 'economico' as const, label: 'Econômico', total: 2500, deliveryDays: 11, sellers: [] }

function stubOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ preference_id: 'pref-1', external_reference: 'ref-1', total: 10400 }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('createPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes productId for each item in the request body', async () => {
    const fetchMock = stubOk()

    await createPreference(items, address, option)

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse((init as RequestInit).body as string)
    expect(sentBody.items[0]).toEqual(
      expect.objectContaining({ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' })
    )
  })

  it('sends only the chosen tier and the total the buyer saw, never a per-service price', async () => {
    const fetchMock = stubOk()

    await createPreference(items, address, option)

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse((init as RequestInit).body as string)
    expect(sentBody.shipping).toEqual({ tier: 'economico', expectedTotal: 2500 })
  })

  it('returns the preference data on success', async () => {
    stubOk()
    expect(await createPreference(items, address, option)).toEqual({
      ok: true,
      data: { preferenceId: 'pref-1', externalReference: 'ref-1', totalCents: 10400 },
    })
  })

  it('returns the new quote when the backend answers 409', async () => {
    const quote = { options: [], unavailableSellers: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'O valor do frete foi atualizado', quote }) }))
    const result = await createPreference(items, address, option)
    expect(result).toEqual({ ok: false, status: 409, error: 'O valor do frete foi atualizado', quote })
  })

  it('does not report success when a 2xx body cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } }))
    expect(await createPreference(items, address, option)).toEqual({
      ok: false, status: 200, error: 'Erro ao preparar o pagamento.',
    })
  })
})
