// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import CarrinhoPage from '../page'
import { useCartStore } from '@/lib/cart-store'
import { formatPrice } from '@/lib/api'

const price = (cents: number) => formatPrice(cents).replace(/\s+/g, ' ')
const item = (variantId: string, title: string, unit: number, quantity: number) => ({
  productId: `p-${variantId}`, variantId, title, variantTitle: 'Padrão', price: unit, quantity,
})

describe('CarrinhoPage', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
  })

  it('shows the empty state with a link to the products', () => {
    render(<CarrinhoPage />)
    expect(screen.getByText('Seu carrinho está vazio')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explorar produtos' })).toHaveAttribute('href', '/produtos')
  })

  it('sums the items and updates the total when a quantity changes', async () => {
    useCartStore.setState({ items: [item('v1', 'Colar', 3000, 1), item('v2', 'Brinco', 2000, 2)] })
    const user = userEvent.setup()
    render(<CarrinhoPage />)

    expect(screen.getByText('Carrinho (3 itens)')).toBeInTheDocument()
    expect(screen.getAllByText(price(7000))).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Aumentar quantidade de Colar' }))
    expect(screen.getAllByText(price(10000))).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Diminuir quantidade de Brinco' }))
    expect(screen.getAllByText(price(8000))).toHaveLength(2)
  })

  it('removes an item', async () => {
    useCartStore.setState({ items: [item('v1', 'Colar', 3000, 1), item('v2', 'Brinco', 2000, 1)] })
    const user = userEvent.setup()
    render(<CarrinhoPage />)

    await user.click(screen.getAllByRole('button', { name: 'Remover' })[0])

    expect(screen.queryByText('Colar')).not.toBeInTheDocument()
    expect(screen.getByText('Carrinho (1 item)')).toBeInTheDocument()
  })

  it('goes to checkout', () => {
    useCartStore.setState({ items: [item('v1', 'Colar', 3000, 1)] })
    render(<CarrinhoPage />)
    expect(screen.getByRole('link', { name: 'Finalizar compra' })).toHaveAttribute('href', '/checkout')
  })
})
