'use client'

import { useEffect } from 'react'
import { initMercadoPago, Payment } from '@mercadopago/sdk-react'

const MP_PUBLIC_KEY = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? ''
const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

// Calls the Medusa store API directly, the same way every other checkout
// request does (fetchShippingRates, createPreference in checkout/page.tsx).
// In production NEXT_PUBLIC_MEDUSA_URL points at .../api, which nginx proxies
// straight to Medusa. A same-origin path like `/api/checkout/payment` gets
// caught by that same nginx `/api/` rule and forwarded to a Medusa route
// that doesn't exist, so it must never be used here.
export async function submitPayment(
  paymentFields: Record<string, unknown>,
  externalReference: string,
  amountCents: number
): Promise<{ payment_id: string }> {
  const res = await fetch(`${MEDUSA_URL}/store/checkout/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
    body: JSON.stringify({
      ...paymentFields,
      external_reference: externalReference,
      transaction_amount: amountCents / 100,
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error ?? `Erro ao processar pagamento (${res.status}).`)
  }

  return data
}

type Props = {
  preferenceId: string
  externalReference: string
  amountCents: number
  onSuccess: (paymentId: string) => void
  onError: (message: string) => void
}

export default function MercadoPagoBrick({
  preferenceId,
  externalReference,
  amountCents,
  onSuccess,
  onError,
}: Props) {
  useEffect(() => {
    initMercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' })
  }, [])

  async function handleSubmit(brickData: Record<string, unknown>): Promise<void> {
    // IPaymentFormData nests the actual payment fields inside .formData
    const paymentFields = (brickData.formData ?? brickData) as Record<string, unknown>
    console.log('[MercadoPagoBrick] brickData:', JSON.stringify(brickData, null, 2))
    console.log('[MercadoPagoBrick] paymentFields:', JSON.stringify(paymentFields, null, 2))

    try {
      const data = await submitPayment(paymentFields, externalReference, amountCents)
      console.log('[MercadoPagoBrick] response:', JSON.stringify(data))

      onSuccess(String(data.payment_id))
    } catch (err) {
      console.error('[MercadoPagoBrick] fetch error:', err)
      const msg = (err as Error)?.message ?? 'Erro ao processar pagamento.'
      onError(msg)
      throw err
    }
  }

  function handleError(err: unknown) {
    console.error('[MercadoPagoBrick] brick error:', err)
    const msg = (err as { message?: string })?.message ?? 'Erro no formulário de pagamento.'
    onError(msg)
  }

  return (
    <Payment
      initialization={{
        amount: amountCents / 100,
        preferenceId,
      }}
      customization={{
        paymentMethods: {
          creditCard: 'all',
          debitCard: 'all',
          ticket: 'all',
          bankTransfer: 'all',
          maxInstallments: 12,
        },
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onSubmit={handleSubmit as any}
      onError={handleError}
    />
  )
}
