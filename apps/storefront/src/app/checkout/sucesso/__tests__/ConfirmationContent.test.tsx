// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let search = ''

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}))

import ConfirmationContent from '../ConfirmationContent'

describe('ConfirmationContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    search = ''
  })

  it('confirms a test cash order without calling the MercadoPago confirm endpoint', async () => {
    search = 'test_cash=ref-test-1'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ConfirmationContent />)

    const status = await screen.findByTestId('confirmation-status')
    expect(status).toHaveTextContent('Pedido confirmado!')
    expect(status).toHaveAttribute('data-status', 'approved')
    expect(screen.getByText(/pagamento em dinheiro \(teste\)/i)).toBeInTheDocument()
    expect(screen.getByText(/ref-test-1/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still confirms MercadoPago payments through the confirm endpoint', async () => {
    search = 'payment_id=42'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'approved',
        status_detail: 'accredited',
        external_reference: 'ref-mp-1',
        transaction_amount: 79,
        payer: {},
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ConfirmationContent />)

    expect(await screen.findByTestId('confirmation-status')).toHaveAttribute('data-status', 'approved')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/store\/checkout\/confirm\?payment_id=42$/)
    expect(screen.queryByText(/pagamento em dinheiro \(teste\)/i)).not.toBeInTheDocument()
  })
})
