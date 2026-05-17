import Link from 'next/link'
import { CheckCircle } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pedido confirmado' }

export default function CheckoutSucessoPage() {
  return (
    <div className="bg-cream min-h-[70vh] flex items-center justify-center">
      <div className="text-center px-4 max-w-md">
        <CheckCircle className="h-16 w-16 text-forest mx-auto mb-4" />
        <h1 className="font-display text-3xl font-black text-onyx">Pedido confirmado!</h1>
        <p className="text-onyx/60 mt-3 leading-relaxed">
          Obrigada pela compra no Mercado Preto. Você receberá um e-mail de confirmação em breve.
          O(a) vendedor(a) também foi notificado(a) pelo WhatsApp.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/produtos"
            className="rounded-xl bg-amber px-6 py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors"
          >
            Continuar comprando
          </Link>
          <Link
            href="/"
            className="text-sm text-onyx/50 hover:text-amber transition-colors"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  )
}
