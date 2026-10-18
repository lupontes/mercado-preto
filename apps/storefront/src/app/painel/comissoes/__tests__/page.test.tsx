// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatPrice } from '@/lib/api'

// Plain stub: Vitest 4 reports a vi.fn returning a rejected promise as unhandled.
const api = vi.hoisted(() => ({ impl: async (): Promise<unknown> => ({}) }))
vi.mock('@/lib/seller-api', () => ({ getSellerCommissions: () => api.impl() }))

import ComissoesPage from '../page'

const price = (cents: number) => formatPrice(cents).replace(/\s+/g, ' ')

describe('ComissoesPage', () => {
  beforeEach(() => {
    api.impl = async () => ({
      commissions: [{ id: 'c1', orderId: 'order_1', grossAmount: 10000, commissionAmount: 1000, sellerPayout: 9000, status: 'paid', created_at: '2026-10-01T10:00:00Z' }],
      totals: { grossAmount: 250000, commissionAmount: 25000, sellerPayout: 225000 },
      count: 25,
    })
  })

  it('shows the totals of every sale and the rows', async () => {
    render(<ComissoesPage />)

    expect(await screen.findByText(price(250000))).toBeInTheDocument()
    expect(screen.getByText(price(225000))).toBeInTheDocument()
    expect(screen.getByText('Pago')).toBeInTheDocument()
  })

  it('tells the seller when the commissions cannot be loaded', async () => {
    api.impl = async () => { throw new Error('API 500') }
    render(<ComissoesPage />)

    expect(await screen.findByText('Não foi possível carregar as comissões. Tente novamente.')).toBeInTheDocument()
    // Zeroed totals would read as "no sales" — they must not show on a failure.
    expect(screen.queryByText('Total de vendas (bruto)')).not.toBeInTheDocument()
  })
})
