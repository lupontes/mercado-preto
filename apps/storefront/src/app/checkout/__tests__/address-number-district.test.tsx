// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => function BrickStub() { return <div /> } }))

import CheckoutPage from '../page'
import { useCartStore } from '@/lib/cart-store'
import { buildCheckoutRequestBody } from '../create-preference'

const viaCep = { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' }

function stubFetch() {
  const quoteCalls = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('viacep')) return { ok: true, json: async () => viaCep }
    if (u.includes('/store/shipping/quote')) {
      quoteCalls()
      return { ok: true, status: 200, json: async () => ({ options: [], unavailableSellers: [] }) }
    }
    return { ok: true, json: async () => ({ enabled: false }) }
  }))
  return quoteCalls
}

describe('CheckoutPage number and district fields', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
    localStorage.setItem('mercado-preto-cart', JSON.stringify({
      state: { items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7900, quantity: 1 }], selectedShipping: null },
      version: 1,
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows Número and Bairro right after Endereço', () => {
    stubFetch()
    const { container } = render(<CheckoutPage />)
    const labels = Array.from(container.querySelectorAll('form label')).map((l) => l.textContent?.replace(/\s+/g, ' ').trim())
    const at = labels.findIndex((l) => l?.startsWith('Endereço'))
    expect(labels[at + 1]).toBe('Número *')
    expect(labels[at + 2]).toBe('Bairro *')
  })

  it('fills Bairro from ViaCEP and leaves Número empty', async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<CheckoutPage />)
    await user.type(screen.getByLabelText(/CEP/), '01310100')
    await user.tab()
    expect(await screen.findByDisplayValue('Bela Vista')).toBe(screen.getByLabelText(/Bairro/))
    expect(screen.getByLabelText(/Número/)).toHaveValue('')
  })

  it.each([
    ['Número', 'Informe o número.'],
    ['Bairro', 'Informe o bairro.'],
  ])('blocks Calcular frete when %s is empty', async (emptyLabel, message) => {
    const quoteCalls = stubFetch()
    const user = userEvent.setup()
    render(<CheckoutPage />)
    await user.type(screen.getByLabelText(/Nome \*/), 'João')
    await user.type(screen.getByLabelText(/Sobrenome/), 'Silva')
    await user.type(screen.getByLabelText(/E-mail/), 'joao@email.com')
    await user.type(screen.getByLabelText(/CPF/), '11144477735')
    await user.type(screen.getByLabelText(/CEP/), '01310100')
    await user.tab()
    await screen.findByDisplayValue('Bela Vista')
    if (emptyLabel === 'Número') {
      await user.clear(screen.getByLabelText(/Bairro/))
      await user.type(screen.getByLabelText(/Bairro/), 'Bela Vista')
    } else {
      await user.type(screen.getByLabelText(/Número/), '1000')
      await user.clear(screen.getByLabelText(/Bairro/))
    }
    await user.click(screen.getByRole('button', { name: /calcular frete/i }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(quoteCalls).not.toHaveBeenCalled()
  })
})

describe('buildCheckoutRequestBody', () => {
  it('carries address.number and address.district', () => {
    const address = {
      firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '', document: '11144477735', cep: '01310100',
      address1: 'Av Paulista', number: '1000', district: 'Bela Vista', address2: '', city: 'São Paulo', state: 'SP',
    }
    const body = buildCheckoutRequestBody([], address, { tier: 'economico', label: 'E', total: 0, deliveryDays: 1, sellers: [] })
    expect(body.address).toMatchObject({ number: '1000', district: 'Bela Vista' })
  })
})
