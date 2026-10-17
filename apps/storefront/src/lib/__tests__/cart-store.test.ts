// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useCartStore } from '../cart-store'

describe('cart store shipping', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
  })

  it('adds the selected option total to the cart total', () => {
    useCartStore.setState({
      items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7700, quantity: 2 }],
    })
    useCartStore.getState().setShipping({ tier: 'economico', label: 'Econômico', total: 3679, deliveryDays: 11, sellers: [] })
    expect(useCartStore.getState().total()).toBe(2 * 7700 + 3679)
  })

  it('drops a persisted legacy shipping selection (price without tier) on rehydrate', async () => {
    localStorage.setItem('mercado-preto-cart', JSON.stringify({
      state: {
        items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7700, quantity: 1 }],
        selectedShipping: { id: 'pac', name: 'PAC', company: 'Correios', price: 2490, currency: 'brl', delivery_time: '7 dias' },
      },
      version: 0,
    }))
    await useCartStore.persist.rehydrate()
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().selectedShipping).toBeNull()
  })

  it('clears the shipping selection when the cart changes', () => {
    useCartStore.setState({
      items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7700, quantity: 1 }],
      selectedShipping: { tier: 'economico', label: 'Econômico', total: 3679, deliveryDays: 11, sellers: [] },
    })
    useCartStore.getState().updateQuantity('v', 2)
    expect(useCartStore.getState().selectedShipping).toBeNull()
  })

  it('applyPriceChanges updates price and title only for the listed variants', () => {
    useCartStore.setState({
      items: [
        { productId: 'p1', variantId: 'v1', title: 'Colar', variantTitle: 'Ouro', price: 7700, quantity: 2 },
        { productId: 'p2', variantId: 'v2', title: 'Anel', variantTitle: 'P', price: 3000, quantity: 1 },
      ],
    })
    useCartStore.getState().applyPriceChanges([{ variantId: 'v1', price: 8100, title: 'Colar Novo' }])
    const [first, second] = useCartStore.getState().items
    expect(first).toEqual({ productId: 'p1', variantId: 'v1', title: 'Colar Novo', variantTitle: 'Ouro', price: 8100, quantity: 2 })
    expect(second.price).toBe(3000)
    expect(second.title).toBe('Anel')
  })

  it('applyPriceChanges persists the new price in the same stored shape', () => {
    useCartStore.setState({
      items: [{ productId: 'p1', variantId: 'v1', title: 'Colar', variantTitle: 'Ouro', price: 7700, quantity: 1 }],
    })
    useCartStore.getState().applyPriceChanges([{ variantId: 'v1', price: 8100, title: 'Colar' }])
    const stored = JSON.parse(localStorage.getItem('mercado-preto-cart')!)
    expect(stored.state.items[0]).toEqual({ productId: 'p1', variantId: 'v1', title: 'Colar', variantTitle: 'Ouro', price: 8100, quantity: 1 })
  })
})
