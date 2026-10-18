// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatPrice } from '@/lib/api'
import { useSellerStore } from '@/lib/seller-store'

const api = vi.hoisted(() => ({ impl: async (): Promise<unknown> => ({}) }))
vi.mock('@/lib/seller-api', () => ({ getDashboard: () => api.impl() }))

import DashboardPage from '../page'

const price = (cents: number) => formatPrice(cents).replace(/\s+/g, ' ')

describe('DashboardPage', () => {
  beforeEach(() => {
    useSellerStore.setState({ seller: { id: 's1', name: 'Loja Axé', email: 'a@b.com', status: 'active' } as any })
    api.impl = async () => ({ stats: { totalOrders: 12, pendingOrders: 3, productCount: 8, totalRevenue: 90000, pendingPayout: 4500 } })
  })

  it('shows the store numbers', async () => {
    render(<DashboardPage />)

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText(price(4500))).toBeInTheDocument()
    expect(screen.getByText(/Olá, Loja/)).toBeInTheDocument()
  })

  it('shows the error message when the dashboard fails', async () => {
    api.impl = async () => { throw new Error('Sessão expirada') }
    render(<DashboardPage />)
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument()
  })
})
