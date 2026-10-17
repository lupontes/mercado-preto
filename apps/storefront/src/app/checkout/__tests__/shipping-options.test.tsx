// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ShippingOptions from '../ShippingOptions'
import { formatPrice } from '@/lib/api'
import type { ShippingQuote } from '@/lib/cart-store'

// Intl may emit a non-breaking space; testing-library normalizes it in the DOM text only.
const price = (cents: number) => formatPrice(cents).replace(/\s+/g, ' ')

const seller = (id: string, name: string, service: 'PAC' | 'SEDEX', price: number) => ({
  sellerId: id, sellerName: name, tier: service === 'PAC' ? 'economico' as const : 'rapido' as const,
  service, serviceId: service === 'PAC' ? 1 : 2, price, deliveryDays: 9,
})
const twoSellers: ShippingQuote = {
  options: [
    { tier: 'economico', label: 'Econômico', total: 7410, deliveryDays: 14, sellers: [seller('a', 'Loja A', 'PAC', 3679), seller('b', 'Loja B', 'PAC', 3731)] },
    { tier: 'rapido', label: 'Rápido', total: 15140, deliveryDays: 7, sellers: [seller('a', 'Loja A', 'SEDEX', 7572), seller('b', 'Loja B', 'SEDEX', 7568)] },
  ],
  unavailableSellers: [],
}

describe('ShippingOptions', () => {
  it('shows Econômico and Rápido with total and delivery time, and selects on click', async () => {
    const onSelect = vi.fn()
    render(<ShippingOptions quote={twoSellers} selected={null} onSelect={onSelect} onRetry={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Econômico/ })).toBeInTheDocument()
    expect(screen.getByText(price(7410))).toBeInTheDocument()
    expect(screen.getByText('chega em até 14 dias úteis')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Rápido/ }))
    expect(onSelect).toHaveBeenCalledWith(twoSellers.options[1])
  })

  it('explains that a multi-store order arrives in several packages, with per-store details', async () => {
    render(<ShippingOptions quote={twoSellers} selected={twoSellers.options[0]} onSelect={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText('Seu pedido sai de 2 lojas e chega em 2 pacotes separados.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ver detalhes' }))
    expect(screen.getByText('Loja A — PAC')).toBeInTheDocument()
    expect(screen.getByText(price(3679))).toBeInTheDocument()
  })

  it('shows which Correios service each store uses when an option mixes them', async () => {
    // A same-city store has no PAC, so its Econômico goes by SEDEX.
    const mixed = { tier: 'economico' as const, label: 'Econômico', total: 3297, deliveryDays: 9, sellers: [seller('a', 'Loja A', 'SEDEX', 1297), seller('b', 'Loja B', 'PAC', 2000)] }
    render(<ShippingOptions quote={{ ...twoSellers, options: [mixed, twoSellers.options[1]] }} selected={mixed} onSelect={vi.fn()} onRetry={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'ver detalhes' }))
    expect(screen.getByText('Loja A — SEDEX')).toBeInTheDocument()
    expect(screen.getByText(price(1297))).toBeInTheDocument()
    expect(screen.getByText('Loja B — PAC')).toBeInTheDocument()
    expect(screen.getByText(price(2000))).toBeInTheDocument()
  })

  it('renders only the tiers that came back', () => {
    render(<ShippingOptions quote={{ ...twoSellers, options: [twoSellers.options[0]] }} selected={null} onSelect={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getAllByRole('radio')).toHaveLength(1)
  })

  it('blocks with a per-store message when a store cannot ship, and offers retry for quote failures', async () => {
    const onRetry = vi.fn()
    render(
      <ShippingOptions
        quote={{ options: [], unavailableSellers: [
          { sellerId: 'b', sellerName: 'Loja B', reason: 'missing_address', productTitles: ['Bolsa'] },
          { sellerId: 'c', sellerName: 'Loja C', reason: 'quote_failed', productTitles: ['Caneca'] },
          { sellerId: 'd', sellerName: 'Loja D', reason: 'oversized', productTitles: ['Balaio'] },
        ] }}
        selected={null} onSelect={vi.fn()} onRetry={onRetry}
      />
    )
    expect(screen.getByText(/Não foi possível calcular o frete para os produtos da loja Loja B/)).toBeInTheDocument()
    expect(screen.getByText(/O produto Balaio não pode ser enviado pelos Correios/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
