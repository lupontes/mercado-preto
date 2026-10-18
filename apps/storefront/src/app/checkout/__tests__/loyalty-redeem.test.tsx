// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatPrice } from '@/lib/api'

// Plain stubs: Vitest 4 reports a vi.fn returning a rejected promise as unhandled.
const api = vi.hoisted(() => ({
  codeCalls: vi.fn(),
  verifyCalls: vi.fn(),
  verify: async (): Promise<{ token: string; balance: number }> => ({ token: 'tok-1', balance: 250 }),
}))
vi.mock('@/lib/loyalty-api', () => ({
  requestLoyaltyCode: async (document: string) => {
    api.codeCalls(document)
    return 'Se houver compras com este documento, enviamos um código para o e-mail usado nelas.'
  },
  verifyLoyaltyCode: (document: string, code: string) => {
    api.verifyCalls(document, code)
    return api.verify()
  },
}))

import LoyaltyRedeem from '../LoyaltyRedeem'

const price = (cents: number) => formatPrice(cents).replace(/\s+/g, ' ')
// Accessible names keep the non-breaking space formatPrice emits; compare normalized.
const named = (label: string) => ({ name: (n: string) => n.replace(/\s+/g, ' ') === label })

describe('LoyaltyRedeem', () => {
  beforeEach(() => {
    api.codeCalls.mockReset()
    api.verifyCalls.mockReset()
    api.verify = async () => ({ token: 'tok-1', balance: 250 })
    localStorage.clear()
  })

  async function confirm(onChange = vi.fn(), maxDiscountCents = 10000) {
    const user = userEvent.setup()
    render(<LoyaltyRedeem document="529.982.247-25" maxDiscountCents={maxDiscountCents} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Enviar código para o e-mail das compras anteriores' }))
    await user.type(await screen.findByLabelText('Código'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    return { user, onChange }
  }

  it('sends the code, verifies it and shows the balance', async () => {
    await confirm()

    expect(api.codeCalls).toHaveBeenCalledWith('529.982.247-25')
    expect(api.verifyCalls).toHaveBeenCalledWith('529.982.247-25', '123456')
    expect(await screen.findByText(`Saldo: ${price(250)}`)).toBeInTheDocument()
  })

  it('uses the points and reports them with the token', async () => {
    const { user, onChange } = await confirm()
    await user.click(await screen.findByRole('button', named(`Usar ${price(250)}`)))

    expect(onChange).toHaveBeenLastCalledWith({ redeemPoints: 250, loyaltyToken: 'tok-1' })
    expect(JSON.stringify({ ...localStorage })).not.toContain('tok-1')
  })

  it('offers no more than the purchase allows', async () => {
    const { user, onChange } = await confirm(vi.fn(), 120)
    await user.click(await screen.findByRole('button', named(`Usar ${price(120)}`)))
    expect(onChange).toHaveBeenLastCalledWith({ redeemPoints: 120, loyaltyToken: 'tok-1' })
  })

  it('shows the error for a wrong code', async () => {
    api.verify = async () => { throw new Error('Código inválido ou expirado.') }
    await confirm()
    expect(await screen.findByText('Código inválido ou expirado.')).toBeInTheDocument()
  })

  it('stops using the points', async () => {
    const { user, onChange } = await confirm()
    await user.click(await screen.findByRole('button', named(`Usar ${price(250)}`)))
    await user.click(screen.getByRole('button', { name: 'Não usar pontos' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
