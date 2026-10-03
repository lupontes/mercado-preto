// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfirmationContent from '../ConfirmationContent'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('payment_id=123&status=approved'),
}))

describe('ConfirmationContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('confirms the payment through a relative URL so the https page is not blocked as mixed content', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEDUSA_URL', 'http://168.138.148.67:9000')
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => null })
    vi.stubGlobal('fetch', fetchMock)

    render(<ConfirmationContent />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/store/checkout/confirm?payment_id=123')
  })
})
