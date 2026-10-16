import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAddressByCep, hasShippingOrigin } from '../seller-address'

describe('hasShippingOrigin', () => {
  it('requires CEP, street, number, district, city and UF', () => {
    const full = { addressPostalCode: '44300000', addressStreet: 'Rua A', addressNumber: '1', addressDistrict: 'Centro', addressCity: 'Cachoeira', addressState: 'BA' }
    expect(hasShippingOrigin(full)).toBe(true)
    expect(hasShippingOrigin({ ...full, addressNumber: '' })).toBe(false)
    expect(hasShippingOrigin({})).toBe(false)
  })
})

describe('fetchAddressByCep', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps ViaCEP fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ logradouro: 'Rua Ana Nery', bairro: 'Centro', localidade: 'Cachoeira', uf: 'BA' }) }))
    expect(await fetchAddressByCep('44300-000')).toEqual({ street: 'Rua Ana Nery', district: 'Centro', city: 'Cachoeira', state: 'BA' })
    expect((fetch as any).mock.calls[0][0]).toBe('https://viacep.com.br/ws/44300000/json/')
  })

  it('returns null for unknown CEPs, short input and network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) }))
    expect(await fetchAddressByCep('00000000')).toBeNull()
    expect(await fetchAddressByCep('123')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await fetchAddressByCep('44300000')).toBeNull()
  })
})
