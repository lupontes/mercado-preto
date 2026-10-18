import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('sitemap.xml and robots', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_MEDUSA_URL', 'http://medusa:9000')
    vi.stubEnv('NEXT_PUBLIC_PUBLISHABLE_KEY', 'pk_test')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://teste.mercadopreto.com.br')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('serves the backend sitemap with the publishable key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<urlset/>' })
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../sitemap.xml/route')

    const res = await GET()

    expect(fetchMock).toHaveBeenCalledWith('http://medusa:9000/store/sitemap', expect.objectContaining({
      headers: expect.objectContaining({ 'x-publishable-api-key': 'pk_test' }),
    }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(await res.text()).toBe('<urlset/>')
  })

  it('answers 503 when the backend fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'err' }))
    const { GET } = await import('../sitemap.xml/route')
    expect((await GET()).status).toBe(503)
  })

  it('answers 503 when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const { GET } = await import('../sitemap.xml/route')
    expect((await GET()).status).toBe(503)
  })

  it('keeps private areas out of search engines and points to the sitemap', async () => {
    const { default: robots } = await import('../robots')
    const rules = robots()

    expect(rules.rules).toMatchObject({ userAgent: '*', allow: '/', disallow: ['/painel', '/checkout', '/carrinho'] })
    expect(rules.sitemap).toBe('https://teste.mercadopreto.com.br/sitemap.xml')
  })
})
