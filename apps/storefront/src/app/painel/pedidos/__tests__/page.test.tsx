// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ impl: async (): Promise<unknown> => ({}) }))
vi.mock('@/lib/seller-api', () => ({ getSellerOrders: () => api.impl() }))

import PedidosPage from '../page'

describe('PedidosPage', () => {
  beforeEach(() => {
    api.impl = async () => ({
      orders: [{ id: 'order_01ABC', display_id: 41, status: 'pending', shipping_status: null, total: 24116, created_at: '2026-10-17T10:00:00Z' }],
    })
  })

  it('lists the orders with number and status', async () => {
    render(<PedidosPage />)
    expect(await screen.findByText('#41')).toBeInTheDocument()
    expect(screen.getByText('Pendente')).toBeInTheDocument()
  })

  it('tells the seller when the orders cannot be loaded', async () => {
    api.impl = async () => { throw new Error('API 500') }
    render(<PedidosPage />)
    expect(await screen.findByText('Não foi possível carregar os pedidos. Tente novamente.')).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum pedido/)).not.toBeInTheDocument()
  })
})
