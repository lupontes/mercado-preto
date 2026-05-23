'use client'

import { useEffect } from 'react'
import { initMercadoPago, Payment } from '@mercadopago/sdk-react'

const MP_PUBLIC_KEY = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? ''
const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

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

  async function handleSubmit(formData: Record<string, unknown>) {
    const res = await fetch(`${MEDUSA_URL}/store/checkout/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': PUB_KEY,
      },
      body: JSON.stringify({
        ...formData,
        external_reference: externalReference,
        transaction_amount: amountCents / 100,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.error ?? 'Erro ao processar pagamento.')
    }

    onSuccess(String(data.payment_id))
  }

  function handleError(err: { message?: string }) {
    onError(err?.message ?? 'Erro no formulário de pagamento.')
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
          atm: 'none',
          maxInstallments: 12,
        },
      }}
      onSubmit={handleSubmit}
      onError={handleError}
    />
  )
}
