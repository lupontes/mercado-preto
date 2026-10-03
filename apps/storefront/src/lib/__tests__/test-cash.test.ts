import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTestCashEnabled } from '../test-cash'

describe('fetchTestCashEnabled', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when the backend reports enabled: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchTestCashEnabled()).toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/store\/checkout\/test-cash$/)
  })

  it('uses a same-origin relative URL in the browser to avoid mixed content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {})
    // BASE_URL is resolved at module load, so re-import with window defined.
    vi.resetModules()
    const { fetchTestCashEnabled: fn } = await import('../test-cash')

    await fn()

    expect(fetchMock.mock.calls[0][0]).toBe('/store/checkout/test-cash')
  })

  it('returns false when the backend reports enabled: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ enabled: true }) }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false when the body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad json') } }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false for a truthy but non-boolean value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: 'true' }) }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })
})
