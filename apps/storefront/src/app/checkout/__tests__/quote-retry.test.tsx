// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => function BrickStub() { return <div /> } }))

import CheckoutPage from '../page'
import { useCartStore } from '@/lib/cart-store'

const failedQuote = {
  options: [],
  unavailableSellers: [{ sellerId: 's1', sellerName: 'Loja A', reason: 'quote_failed', productTitles: ['Colar'] }],
}
const okQuote = {
  options: [{ tier: 'economico', label: 'Econômico', total: 2500, deliveryDays: 11, sellers: [] }],
  unavailableSellers: [],
}

function stub(secondQuote: () => Promise<unknown>) {
  let quoteCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/store/shipping/quote')) {
      return quoteCalls++ === 0 ? { ok: true, status: 200, json: async () => failedQuote } : secondQuote()
    }
    if (u.includes('viacep')) return { ok: true, json: async () => ({ erro: true }) }
    return { ok: true, json: async () => ({ enabled: false }) }
  }))
}

async function reachShippingStep(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const inputs = container.querySelectorAll<HTMLInputElement>('form input')
  await user.type(inputs[0], 'João')
  await user.type(inputs[1], 'Silva')
  await user.type(inputs[2], 'joao@email.com')
  await user.type(inputs[3], '11144477735')
  await user.type(inputs[5], '44300000')
  await user.type(inputs[8], 'Rua das Flores')
  await user.click(screen.getByRole('button', { name: /calcular frete/i }))
  return screen.findByRole('button', { name: 'Tentar novamente' })
}

describe('CheckoutPage quote retry', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
    localStorage.setItem('mercado-preto-cart', JSON.stringify({
      state: { items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7900, quantity: 1 }], selectedShipping: null },
      version: 1,
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the options when the retry succeeds', async () => {
    stub(async () => ({ ok: true, status: 200, json: async () => okQuote }))
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)
    await user.click(await reachShippingStep(user, container))
    expect(await screen.findByRole('radio', { name: /Econômico/ })).toBeInTheDocument()
  })

  it('shows an error instead of an unhandled rejection when the retry fails', async () => {
    stub(async () => { throw new TypeError('Failed to fetch') })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)
    await user.click(await reachShippingStep(user, container))
    expect(await screen.findByText(/Não foi possível calcular o frete\. Verifique sua conexão/)).toBeInTheDocument()
  })
})
