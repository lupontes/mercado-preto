// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Captures the Brick's onSubmit so the test can drive a payment without the external SDK.
const brick = vi.hoisted(() => ({ onSubmit: undefined as undefined | ((data: unknown) => Promise<void>) }))
vi.mock('@mercadopago/sdk-react', () => ({
  initMercadoPago: vi.fn(),
  Payment: (props: { onSubmit: (data: unknown) => Promise<void> }) => {
    brick.onSubmit = props.onSubmit
    return null
  },
}))

import MercadoPagoBrick from '../MercadoPagoBrick'

function renderBrick() {
  const onSuccess = vi.fn()
  const onError = vi.fn()
  render(<MercadoPagoBrick preferenceId="pref-1" externalReference="ref-1" amountCents={10400} onSuccess={onSuccess} onError={onError} />)
  return { onSuccess, onError }
}

const respondWith = (body: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }))

describe('MercadoPagoBrick submit', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports a refused card as an error and never as a success, so the cart is kept', async () => {
    respondWith({ payment_id: 9, status: 'rejected', message: 'Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix.' })
    const { onSuccess, onError } = renderBrick()

    await expect(brick.onSubmit!({ formData: { token: 't' } })).rejects.toThrow()

    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix.')
  })

  it('reports a pending Pix as a success', async () => {
    respondWith({ payment_id: 7, status: 'pending' })
    const { onSuccess, onError } = renderBrick()

    await brick.onSubmit!({ formData: { payment_method_id: 'pix' } })

    expect(onSuccess).toHaveBeenCalledWith('7')
    expect(onError).not.toHaveBeenCalled()
  })
})
