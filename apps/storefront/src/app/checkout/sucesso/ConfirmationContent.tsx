'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react'
import { formatPrice } from '@/lib/api'

const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

type ConfirmData = {
  status: string
  status_detail: string
  external_reference: string
  transaction_amount: number
  payer: { email?: string; first_name?: string; last_name?: string }
  metadata?: {
    items?: Array<{ title: string; quantity: number; price: number }>
    shipping?: { name: string; price: number }
    total?: number
  }
}

export default function ConfirmationContent() {
  const params = useSearchParams()
  const paymentId = params.get('payment_id') ?? params.get('collection_id')
  const urlStatus = params.get('status')

  const [data, setData] = useState<ConfirmData | null>(null)
  const [loading, setLoading] = useState(!!paymentId)

  useEffect(() => {
    if (!paymentId) return

    fetch(`${MEDUSA_URL}/store/checkout/confirm?payment_id=${paymentId}`, {
      headers: { 'x-publishable-api-key': PUB_KEY },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [paymentId])

  if (loading) {
    return (
      <div className="bg-cream min-h-[70vh] flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber" />
      </div>
    )
  }

  const status = data?.status ?? urlStatus
  const isApproved = status === 'approved'
  const isPending = status === 'pending' || status === 'in_process'

  return (
    <div className="bg-cream min-h-[70vh] flex items-center justify-center">
      <div className="text-center px-4 max-w-md w-full">
        {isApproved ? (
          <CheckCircle className="h-16 w-16 text-forest mx-auto mb-4" />
        ) : isPending ? (
          <Clock className="h-16 w-16 text-amber mx-auto mb-4" />
        ) : (
          <XCircle className="h-16 w-16 text-terracotta mx-auto mb-4" />
        )}

        <h1 className="font-display text-3xl font-black text-onyx">
          {isApproved
            ? 'Pedido confirmado!'
            : isPending
            ? 'Pagamento em análise'
            : 'Pagamento não confirmado'}
        </h1>

        <p className="text-onyx/60 mt-3 leading-relaxed">
          {isApproved
            ? 'Obrigada pela compra no Mercado Preto. Você receberá um e-mail de confirmação em breve.'
            : isPending
            ? 'Seu pagamento está sendo processado. Assim que confirmado, seu pedido será liberado automaticamente.'
            : 'Não foi possível confirmar o pagamento. Tente novamente ou entre em contato.'}
        </p>

        {data && (
          <div className="mt-6 rounded-xl bg-white border border-sand-dark p-4 text-left text-sm space-y-2">
            {(data.payer.first_name || data.payer.last_name) && (
              <p className="text-onyx/60">
                <span className="font-semibold text-onyx">Nome: </span>
                {[data.payer.first_name, data.payer.last_name].filter(Boolean).join(' ')}
              </p>
            )}
            {data.payer.email && (
              <p className="text-onyx/60">
                <span className="font-semibold text-onyx">E-mail: </span>
                {data.payer.email}
              </p>
            )}
            <p className="text-onyx/60">
              <span className="font-semibold text-onyx">Total pago: </span>
              {formatPrice(Math.round(data.transaction_amount * 100))}
            </p>
            {data.metadata?.items && data.metadata.items.length > 0 && (
              <div className="border-t border-sand-dark pt-2 mt-2 space-y-1">
                {data.metadata.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-onyx/60">
                    <span>{item.title} × {item.quantity}</span>
                    <span>{formatPrice(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-onyx/40 text-xs font-mono pt-1">
              Ref: {data.external_reference}
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/produtos"
            className="rounded-xl bg-amber px-6 py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors"
          >
            Continuar comprando
          </Link>
          <Link href="/" className="text-sm text-onyx/50 hover:text-amber transition-colors">
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  )
}
