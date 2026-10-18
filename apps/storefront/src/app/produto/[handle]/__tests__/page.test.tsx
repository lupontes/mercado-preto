// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }))
vi.mock('next/navigation', () => ({ notFound, useRouter: () => ({ push: vi.fn() }) }))

const api = vi.hoisted(() => ({
  product: async (): Promise<unknown> => ({ products: [] }),
  reviews: async (): Promise<unknown> => ({ reviews: [], average: null, count: 0 }),
}))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProduct: () => api.product(),
  getProductReviews: () => api.reviews(),
}))

import ProductPage from '../page'

const params = (handle: string) => ({ params: Promise.resolve({ handle }) })

describe('ProductPage', () => {
  beforeEach(() => {
    notFound.mockClear()
    api.reviews = async () => ({ reviews: [], average: null, count: 0 })
  })

  it('renders the product', async () => {
    api.product = async () => ({
      products: [{ id: 'prod_1', title: 'Colar de Contas', description: '<p>Feito à mão</p>', thumbnail: null, variants: [{ id: 'v1', title: 'Padrão', prices: [{ amount: 4990, currency_code: 'brl' }] }], seller: { name: 'Loja Axé' } }],
    })

    render(await ProductPage(params('colar')))

    expect(screen.getByRole('heading', { level: 1, name: 'Colar de Contas' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar aos produtos/ })).toHaveAttribute('href', '/produtos')
  })

  it('answers not found for an unknown handle', async () => {
    api.product = async () => ({ products: [] })
    await expect(ProductPage(params('nao-existe'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('answers not found when the API fails', async () => {
    api.product = async () => { throw new Error('API down') }
    await expect(ProductPage(params('colar'))).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('still renders when the reviews fail', async () => {
    api.product = async () => ({ products: [{ id: 'prod_1', title: 'Colar', description: '', thumbnail: null, variants: [], seller: null }] })
    api.reviews = async () => { throw new Error('reviews down') }

    render(await ProductPage(params('colar')))
    expect(screen.getByRole('heading', { level: 1, name: 'Colar' })).toBeInTheDocument()
  })
})
