import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadSellerImage } from '../seller-api'

describe('uploadSellerImage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the file as multipart with the seller cookie and returns the url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ url: 'https://site/static/produto.jpg' }) })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'foto.jpg', { type: 'image/jpeg' })

    await expect(uploadSellerImage(file)).resolves.toBe('https://site/static/produto.jpg')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/seller\/uploads$/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBe(file)
    // The browser must set the multipart boundary itself.
    expect(init.headers?.['Content-Type']).toBeUndefined()
  })

  it("throws the backend's message on error", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 415, json: async () => ({ error: 'Envie uma foto em JPG, PNG ou WebP.' }) }))
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })

    await expect(uploadSellerImage(file)).rejects.toThrow('Envie uma foto em JPG, PNG ou WebP.')
  })

  it('falls back to a generic message when the error has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json') } }))
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })

    await expect(uploadSellerImage(file)).rejects.toThrow('Não foi possível enviar a foto. Tente novamente.')
  })
})
