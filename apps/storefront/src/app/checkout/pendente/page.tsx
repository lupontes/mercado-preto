import Link from 'next/link'
import { Clock } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pagamento em análise' }

export default function CheckoutPendentePage() {
  return (
    <div className="bg-cream min-h-[70vh] flex items-center justify-center">
      <div className="text-center px-4 max-w-md">
        <Clock className="h-16 w-16 text-amber mx-auto mb-4" />
        <h1 className="font-display text-3xl font-black text-onyx">Pagamento em análise</h1>
        <p className="text-onyx/60 mt-3 leading-relaxed">
          Seu pagamento está sendo processado. Assim que confirmado, você receberá um e-mail e seu
          pedido será liberado automaticamente. Isso pode levar até 2 dias úteis.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/"
            className="rounded-xl bg-amber px-6 py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  )
}
