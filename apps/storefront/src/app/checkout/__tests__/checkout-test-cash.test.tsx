// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}))

// The MercadoPago Brick loads an external SDK; it is irrelevant to these tests.
vi.mock('next/dynamic', () => ({
  default: () => function BrickStub() { return <div data-testid="mp-brick" /> },
}))

import CheckoutPage from '../page'
import { useCartStore } from '@/lib/cart-store'

const rate = { id: 'pac', name: 'PAC', company: 'Correios', price: 2500, currency: 'brl', delivery_time: '5 dias' }

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

function stubBackend({ enabled, testCashResponse }: { enabled: boolean; testCashResponse?: Promise<unknown> }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/store/checkout/sandbox-cash') && init?.method === 'POST') {
      return testCashResponse ?? jsonResponse({ external_reference: 'ref-test-1' })
    }
    if (u.endsWith('/store/checkout/sandbox-cash')) return jsonResponse({ enabled })
    if (u.includes('viacep.com.br')) return jsonResponse({ erro: true })
    if (u.includes('/store/shipping/estimate')) return jsonResponse({ rates: [rate] })
    if (u.includes('/store/checkout/preference')) {
      return jsonResponse({ preference_id: 'pref-1', external_reference: 'ref-mp-1' })
    }
    throw new Error(`Unexpected fetch: ${u}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function seedCart() {
  // The page rehydrates the persisted cart on mount, so seed persisted storage.
  localStorage.setItem(
    'mercado-preto-cart',
    JSON.stringify({
      state: {
        items: [{ productId: 'prod-1', variantId: 'var-1', title: 'Camiseta', variantTitle: 'M', price: 7900, quantity: 1 }],
        selectedShipping: null,
      },
      version: 0,
    })
  )
}

// Address inputs have visual labels without htmlFor, so they are reached by
// position in the form (Nome, Sobrenome, E-mail, CPF/CNPJ, Telefone, CEP,
// Estado, Cidade, Endereço, Complemento).
async function fillAddressAndContinue(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const inputs = container.querySelectorAll<HTMLInputElement>('form input')
  await user.type(inputs[0], 'João')
  await user.type(inputs[1], 'Silva')
  await user.type(inputs[2], 'joao@email.com')
  await user.type(inputs[3], '11144477735')
  await user.type(inputs[5], '44300000')
  await user.type(inputs[6], 'BA')
  await user.type(inputs[7], 'Cachoeira')
  await user.type(inputs[8], 'Rua das Flores')
  await user.click(screen.getByRole('button', { name: /calcular frete/i }))
  await user.click(await screen.findByRole('radio', { name: /PAC/ }))
}

describe('CheckoutPage — test cash payment', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
    seedCart()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    push.mockClear()
    replace.mockClear()
  })

  it('does not offer the test cash option when the backend reports it disabled', async () => {
    const fetchMock = stubBackend({ enabled: false })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/store\/checkout\/sandbox-cash$/), expect.anything())
    expect(screen.queryByTestId('payment-method-test-cash')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir para pagamento/i })).toBeInTheDocument()
  })

  it('creates the order without MercadoPago and redirects to the success page when test cash is chosen', async () => {
    const fetchMock = stubBackend({ enabled: true })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout/sucesso?test_cash=ref-test-1'))
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/store/checkout/preference'))).toBe(false)
    expect(useCartStore.getState().items).toEqual([])
  })

  it('keeps the MercadoPago flow when the option is available but not chosen', async () => {
    const fetchMock = stubBackend({ enabled: true })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    expect(await screen.findByTestId('payment-method-mp')).toBeChecked()
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    expect(await screen.findByTestId('mp-brick')).toBeInTheDocument()
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/store/checkout/preference'))).toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('disables the submit button while the test order is being created (no double submit)', async () => {
    let resolveOrder!: (v: unknown) => void
    const pending = new Promise((r) => { resolveOrder = r })
    stubBackend({ enabled: true, testCashResponse: pending })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    expect(screen.getByTestId('submit-test-cash')).toBeDisabled()
    resolveOrder(jsonResponse({ external_reference: 'ref-test-1' }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
  })

  it('shows an error and stays on the shipping step when the test order fails', async () => {
    stubBackend({ enabled: true, testCashResponse: Promise.resolve(jsonResponse({ error: 'x' }, false)) })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    expect(await screen.findByText('Erro ao criar o pedido de teste. Tente novamente.')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByTestId('submit-test-cash')).not.toBeDisabled()
  })
})
