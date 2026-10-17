'use client'

import { useEffect } from 'react'
import { initMercadoPago, Payment } from '@mercadopago/sdk-react'
import { medusaBaseUrl } from '@/lib/medusa-url'

// The SDK only exports this type from a private path; derive it from the public component instead.
type IBrickError = Parameters<NonNullable<React.ComponentProps<typeof Payment>['onError']>>[0]

const MP_PUBLIC_KEY = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? ''
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

// Goes through medusaBaseUrl() like every other checkout request: a relative
// `/store/...` path in the browser, proxied by nginx to Medusa. A same-origin
// path like `/api/checkout/payment` gets caught by the nginx `/api/` rule and
// forwarded to a Medusa route that doesn't exist, so it must never be used here.
export async function submitPayment(
  paymentFields: Record<string, unknown>,
  externalReference: string
): Promise<{ payment_id: string; status?: string }> {
  const res = await fetch(`${medusaBaseUrl()}/store/checkout/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
    body: JSON.stringify({
      ...paymentFields,
      // The amount is deliberately not sent: the server charges its own snapshot total.
      external_reference: externalReference,
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error ?? `Erro ao processar pagamento (${res.status}).`)
  }

  // A refused card answers 200. Throwing keeps the buyer on the payment step
  // with the cart intact, since only onSuccess clears it.
  if (data.status === 'rejected') {
    throw new Error(data.message ?? 'O pagamento não foi aprovado. Tente outro cartão ou pague com Pix.')
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
    // IPaymentFormData nests the actual payment fields inside .formData.
    // Nothing from it is logged: it carries the payer's e-mail and document.
    const paymentFields = (brickData.formData ?? brickData) as Record<string, unknown>

    try {
      const data = await submitPayment(paymentFields, externalReference)
      onSuccess(String(data.payment_id))
    } catch (err) {
      onError((err as Error)?.message ?? 'Erro ao processar pagamento.')
      throw err
    }
  }

  // The SDK's own text is English and technical, so the buyer gets a short
  // instruction; the cause stays in the console for debugging.
  function handleError(err: IBrickError) {
    console.error(`[MercadoPagoBrick] brick error: ${err?.type} ${err?.cause}`)
    onError(
      err?.type === 'critical'
        ? 'Não foi possível carregar o pagamento. Recarregue a página e tente de novo.'
        : 'Confira os dados do pagamento e tente de novo.'
    )
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
