import { afterEach, describe, expect, it, vi } from 'vitest'

// next.config.ts reads NEXT_PUBLIC_MEDUSA_URL at module load, so each test
// sets the env first and imports a fresh copy.
async function loadRewrites() {
  vi.resetModules()
  const { default: config } = await import('../../next.config')
  // The config returns the plain array form; narrow away the object form.
  return (await config.rewrites!()) as Array<{ source: string; destination: string }>
}

describe('next.config rewrites', () => {
  const originalUrl = process.env.NEXT_PUBLIC_MEDUSA_URL

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_MEDUSA_URL
    else process.env.NEXT_PUBLIC_MEDUSA_URL = originalUrl
  })

  it('proxies /store and /seller to the backend so relative browser calls work without nginx', async () => {
    process.env.NEXT_PUBLIC_MEDUSA_URL = 'http://168.0.0.1:9000'

    expect(await loadRewrites()).toEqual([
      { source: '/store/:path*', destination: 'http://168.0.0.1:9000/store/:path*' },
      { source: '/seller/:path*', destination: 'http://168.0.0.1:9000/seller/:path*' },
    ])
  })

  it('defaults to the local backend and tolerates a trailing slash', async () => {
    delete process.env.NEXT_PUBLIC_MEDUSA_URL
    expect((await loadRewrites())[0]).toEqual({
      source: '/store/:path*',
      destination: 'http://localhost:9000/store/:path*',
    })

    process.env.NEXT_PUBLIC_MEDUSA_URL = 'http://localhost:9000/'
    expect((await loadRewrites())[0].destination).toBe('http://localhost:9000/store/:path*')
  })
})

describe('next.config images.remotePatterns', () => {
  const originalMedusa = process.env.NEXT_PUBLIC_MEDUSA_URL
  const originalSite = process.env.NEXT_PUBLIC_SITE_URL

  afterEach(() => {
    for (const [key, value] of [
      ['NEXT_PUBLIC_MEDUSA_URL', originalMedusa],
      ['NEXT_PUBLIC_SITE_URL', originalSite],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  async function loadRemotePatterns() {
    vi.resetModules()
    const { default: config } = await import('../../next.config')
    return config.images!.remotePatterns!
  }

  it('allows the public site host, since uploaded images are served at <site>/api/static behind nginx', async () => {
    process.env.NEXT_PUBLIC_MEDUSA_URL = 'http://localhost:9000'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://teste.mercadopreto.com.br'

    expect(await loadRemotePatterns()).toEqual(
      expect.arrayContaining([
        { protocol: 'https', hostname: 'teste.mercadopreto.com.br' },
        { protocol: 'http', hostname: 'localhost', port: '9000' },
      ]),
    )
  })

  it('does not add a site pattern when NEXT_PUBLIC_SITE_URL is unset', async () => {
    process.env.NEXT_PUBLIC_MEDUSA_URL = 'http://localhost:9000'
    delete process.env.NEXT_PUBLIC_SITE_URL

    const hosts = (await loadRemotePatterns()).map((p) => ('hostname' in p ? p.hostname : undefined))
    expect(hosts).not.toContain('teste.mercadopreto.com.br')
    expect(hosts).toContain('localhost')
  })
})
