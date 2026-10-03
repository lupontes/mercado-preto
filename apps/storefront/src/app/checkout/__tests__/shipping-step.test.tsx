// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CheckoutPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

describe('CheckoutPage shipping step', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stops loading and shows an error when the shipping request fails at the network level', async () => {
    // A blocked (mixed content) or dropped request rejects instead of
    // resolving with !ok; the button must not spin forever in that case.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.')))
    const user = userEvent.setup()

    render(<CheckoutPage />)
    await user.type(screen.getByPlaceholderText('000.000.000-00'), '11144477735')
    const button = screen.getByRole('button', { name: /Calcular frete/ })
    fireEvent.submit(button.closest('form')!)

    expect(await screen.findByText(/Não foi possível calcular o frete/)).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })
})
