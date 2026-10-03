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
