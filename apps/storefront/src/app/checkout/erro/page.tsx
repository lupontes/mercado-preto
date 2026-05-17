import Link from 'next/link'
import { XCircle } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pagamento não concluído' }

export default function CheckoutErroPage() {
  return (
    <div className="bg-cream min-h-[70vh] flex items-center justify-center">
      <div className="text-center px-4 max-w-md">
        <XCircle className="h-16 w-16 text-terracotta mx-auto mb-4" />
        <h1 className="font-display text-3xl font-black text-onyx">Pagamento não concluído</h1>
        <p className="text-onyx/60 mt-3 leading-relaxed">
          Algo deu errado durante o pagamento. Seus itens ainda estão no carrinho — tente novamente
          ou escolha outra forma de pagamento.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/carrinho"
            className="rounded-xl bg-amber px-6 py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors"
          >
            Voltar ao carrinho
          </Link>
          <Link
            href="/produtos"
            className="text-sm text-onyx/50 hover:text-amber transition-colors"
          >
            Continuar comprando
          </Link>
        </div>
      </div>
    </div>
  )
}
