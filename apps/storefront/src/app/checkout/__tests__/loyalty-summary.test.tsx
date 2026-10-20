// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => function BrickStub() { return <div /> } }))

import CheckoutPage from '../page'
import { useCartStore } from '@/lib/cart-store'

// R$ 182,00 in items at 15% commission: the server allows at most R$ 27,30 in points.
const quote = {
  options: [{ tier: 'economico', label: 'Econômico', total: 6981, deliveryDays: 10, sellers: [] }],
  unavailableSellers: [],
  maxLoyaltyDiscountCents: 2730,
}

function stub(balance: number) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/store/shipping/quote')) return { ok: true, status: 200, json: async () => quote }
    if (u.includes('/store/loyalty/code')) return { ok: true, status: 200, json: async () => ({ message: 'Enviamos um código.' }) }
    if (u.includes('/store/loyalty/verify')) return { ok: true, status: 200, json: async () => ({ token: 't', balance }) }
    if (u.includes('viacep')) return { ok: true, json: async () => ({ erro: true }) }
    return { ok: true, json: async () => ({ enabled: false }) }
  }))
}

async function verifyPoints(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await user.type(screen.getByLabelText(/Nome \*/), 'João')
  await user.type(screen.getByLabelText(/Sobrenome/), 'Silva')
  await user.type(screen.getByLabelText(/E-mail/), 'joao@email.com')
  await user.type(screen.getByLabelText(/CPF/), '11144477735')
  await user.type(screen.getByLabelText(/CEP/), '44300000')
  await user.type(screen.getByLabelText(/Endereço/), 'Rua das Flores')
  await user.type(screen.getByLabelText(/Número/), '10')
  await user.type(screen.getByLabelText(/Bairro/), 'Centro')
  await user.click(screen.getByRole('button', { name: /calcular frete/i }))
  await user.click(await screen.findByRole('button', { name: /Enviar código/ }))
  await user.type(await screen.findByLabelText('Código'), '123456')
  await user.click(screen.getByRole('button', { name: 'Confirmar' }))
}

describe('CheckoutPage points discount on the shipping step', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
    localStorage.setItem('mercado-preto-cart', JSON.stringify({
      state: { items: [{ productId: 'p', variantId: 'v', title: 'Bolsa', variantTitle: '', price: 18200, quantity: 1 }], selectedShipping: null },
      version: 1,
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers no more than the ceiling the server returned with the quote', async () => {
    stub(5000)
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)
    await verifyPoints(user, container)
    expect(await screen.findByRole('button', { name: /^Usar R\$\s27,30$/ })).toBeInTheDocument()
  })

  it('shows the chosen discount in the order summary before the payment step', async () => {
    stub(182)
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)
    await verifyPoints(user, container)
    await user.click(await screen.findByRole('button', { name: /^Usar R\$\s1,82$/ }))
    expect(screen.getByText('Desconto em pontos')).toBeInTheDocument()
    expect(screen.getByText(/^-R\$\s1,82$/)).toBeInTheDocument()
    expect(screen.getByText(/^R\$\s249,99$/)).toBeInTheDocument()
  })
})
