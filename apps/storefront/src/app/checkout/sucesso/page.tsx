import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import ConfirmationContent from './ConfirmationContent'

export const metadata: Metadata = { title: 'Pedido confirmado — Mercado Preto' }

export default function CheckoutSucessoPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-cream min-h-[70vh] flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-amber" />
        </div>
      }
    >
      <ConfirmationContent />
    </Suspense>
  )
}
