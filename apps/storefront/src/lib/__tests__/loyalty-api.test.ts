import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestLoyaltyCode, verifyLoyaltyCode } from '../loyalty-api'

describe('loyalty api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks for a code with the document and the publishable key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'enviado' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestLoyaltyCode('529.982.247-25')).resolves.toBe('enviado')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/store\/loyalty\/code$/)
    expect(init.headers['x-publishable-api-key']).toBeDefined()
    expect(JSON.parse(init.body)).toEqual({ document: '529.982.247-25' })
  })

  it('verifies the code and returns the token and balance', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok', balance: 250 }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyLoyaltyCode('529.982.247-25', '123456')).resolves.toEqual({ token: 'tok', balance: 250 })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/store\/loyalty\/verify$/)
  })

  it("throws the backend's message", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Código inválido ou expirado.' }) }))
    await expect(verifyLoyaltyCode('529.982.247-25', '000000')).rejects.toThrow('Código inválido ou expirado.')
  })
})
