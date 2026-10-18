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
const brickProps = vi.hoisted(() => vi.fn())
vi.mock('next/dynamic', () => ({
  default: () => function BrickStub(props: unknown) { brickProps(props); return <div data-testid="mp-brick" /> },
}))

// The real block talks to the loyalty API; here a stub just hands the page a selection.
vi.mock('../LoyaltyRedeem', () => ({
  default: ({ onChange }: { onChange: (s: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ redeemPoints: 300, loyaltyToken: 'tok-1' })}>stub usar pontos</button>
  ),
}))

import CheckoutPage from '../page'
import { useCartStore } from '@/lib/cart-store'
import { formatPrice } from '@/lib/api'

const economico = (total: number) => ({
  tier: 'economico' as const, label: 'Econômico', total, deliveryDays: 11,
  sellers: [{ sellerId: 's1', sellerName: 'Loja A', tier: 'economico' as const, service: 'PAC' as const, serviceId: 1, price: total, deliveryDays: 9 }],
})
const quoteWith = (total: number) => ({ options: [economico(total)], unavailableSellers: [] })

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body }
}

function stubBackend({ enabled, testCashResponse, preferenceResponse }: { enabled: boolean; testCashResponse?: Promise<unknown>; preferenceResponse?: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/store/checkout/sandbox-cash') && init?.method === 'POST') {
      return testCashResponse ?? jsonResponse({ external_reference: 'ref-test-1' })
    }
    if (u.endsWith('/store/checkout/sandbox-cash')) return jsonResponse({ enabled })
    if (u.includes('viacep.com.br')) return jsonResponse({ erro: true })
    if (u.includes('/store/shipping/quote')) return jsonResponse(quoteWith(2500))
    if (u.includes('/store/checkout/preference')) {
      if (preferenceResponse) return preferenceResponse
      return jsonResponse({ preference_id: 'pref-1', external_reference: 'ref-mp-1', total: 10400 })
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
      version: 1,
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
  await user.click(await screen.findByRole('radio', { name: /Econômico/ }))
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

  it('shows the updated price and keeps the buyer on the shipping step when the backend answers 409', async () => {
    stubBackend({
      enabled: true,
      testCashResponse: Promise.resolve(jsonResponse({ error: 'O valor do frete foi atualizado', quote: quoteWith(2900) }, false, 409)),
    })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    expect(
      await screen.findByText(`O valor do frete foi atualizado para ${formatPrice(2900)}. Confira e continue.`.replace(/\s+/g, ' '))
    ).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  const priceChangedBody = {
    error: 'O preço de alguns produtos foi atualizado',
    priceChanges: [{ variantId: 'var-1', price: 8500, title: 'Camiseta Nova' }],
  }

  it('adopts the new price and stays on the shipping step when the test order answers a price 409', async () => {
    stubBackend({ enabled: true, testCashResponse: Promise.resolve(jsonResponse(priceChangedBody, false, 409)) })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    expect(await screen.findByText('O preço de alguns produtos foi atualizado. Confira e continue.')).toBeInTheDocument()
    expect(useCartStore.getState().items[0]).toMatchObject({ price: 8500, title: 'Camiseta Nova', variantTitle: 'M', quantity: 1 })
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByTestId('submit-test-cash')).toBeInTheDocument()
  })

  it('adopts the new price and stays on the shipping step when the preference answers a price 409', async () => {
    stubBackend({ enabled: false, preferenceResponse: jsonResponse(priceChangedBody, false, 409) })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    expect(await screen.findByText('O preço de alguns produtos foi atualizado. Confira e continue.')).toBeInTheDocument()
    expect(useCartStore.getState().items[0].price).toBe(8500)
    expect(screen.queryByTestId('mp-brick')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir para pagamento/i })).toBeInTheDocument()
  })

  it('hands the server total, not the cart total, to the Brick', async () => {
    // Cart says 7900 + 2500 shipping = 10400; the server answers a different total.
    stubBackend({ enabled: false, preferenceResponse: jsonResponse({ preference_id: 'p', external_reference: 'r', total: 11000 }) })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    await screen.findByTestId('mp-brick')
    expect(brickProps).toHaveBeenLastCalledWith(expect.objectContaining({ amountCents: 11000 }))
  })

  const rapido = (total: number) => ({
    tier: 'rapido' as const, label: 'Rápido', total, deliveryDays: 4,
    sellers: [{ sellerId: 's1', sellerName: 'Loja A', tier: 'rapido' as const, service: 'SEDEX' as const, serviceId: 2, price: total, deliveryDays: 2 }],
  })
  const unavailable422 = (quote: unknown) =>
    jsonResponse({ error: 'Opção de frete indisponível', quote }, false, 422)

  it('preselects the only remaining shipping option after a 422', async () => {
    stubBackend({ enabled: false, preferenceResponse: unavailable422({ options: [rapido(3100)], unavailableSellers: [] }) })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    expect(await screen.findByText('As opções de frete mudaram. Confira e continue.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Rápido/ })).toBeChecked()
    expect(screen.queryByTestId('mp-brick')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir para pagamento/i })).toBeInTheDocument()
  })

  it('keeps the buyer choosing when a 422 leaves two options', async () => {
    stubBackend({ enabled: false, preferenceResponse: unavailable422({ options: [economico(2700), rapido(3100)], unavailableSellers: [] }) })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    expect(await screen.findByText('Opção de frete indisponível')).toBeInTheDocument()
    screen.getAllByRole('radio').forEach((radio) => expect(radio).not.toBeChecked())
  })

  it('does not preselect when a store became unavailable', async () => {
    stubBackend({
      enabled: false,
      preferenceResponse: unavailable422({
        options: [rapido(3100)],
        unavailableSellers: [{ sellerId: 's2', sellerName: 'Loja B', reason: 'quote_failed', productTitles: ['Caneca'] }],
      }),
    })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    expect(await screen.findByText('Opção de frete indisponível')).toBeInTheDocument()
    screen.queryAllByRole('radio').forEach((radio) => expect(radio).not.toBeChecked())
  })

  it('sends the points, shows the discount and takes the earned points to the confirmation', async () => {
    const fetchMock = stubBackend({
      enabled: false,
      preferenceResponse: jsonResponse({ preference_id: 'p', external_reference: 'r', total: 10100, pointsApplied: 300, discount: 300 }),
    })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(screen.getByRole('button', { name: 'stub usar pontos' }))
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    await screen.findByTestId('mp-brick')
    const prefCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/store/checkout/preference'))!
    expect(JSON.parse(String(prefCall[1]!.body))).toMatchObject({ redeemPoints: 300, loyaltyToken: 'tok-1' })
    expect(screen.getByText('Desconto em pontos')).toBeInTheDocument()
    expect(screen.getByText(`-${formatPrice(300)}`.replace(/\s+/g, ' '))).toBeInTheDocument()

    const { onSuccess } = brickProps.mock.calls.at(-1)![0] as { onSuccess: (id: string) => void }
    onSuccess('pay-1')
    // (7900 in items − 300 discount) / 100 = 76 points
    expect(push).toHaveBeenCalledWith('/checkout/sucesso?payment_id=pay-1&pontos=76')
  })
})
