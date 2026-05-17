'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCartStore } from '@/lib/cart-store'
import { formatPrice } from '@/lib/api'
import { Trash2, Minus, Plus, ShoppingBag } from 'lucide-react'

export default function CarrinhoPage() {
  const { items, removeItem, updateQuantity, subtotal, count } = useCartStore()

  if (items.length === 0) {
    return (
      <div className="bg-cream min-h-[60vh] flex items-center justify-center">
        <div className="text-center px-4">
          <ShoppingBag className="h-16 w-16 text-onyx/20 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-black text-onyx">Seu carrinho está vazio</h1>
          <p className="text-onyx/60 mt-2">Descubra produtos de afroemprendedores</p>
          <Link
            href="/produtos"
            className="mt-6 inline-block rounded-lg bg-amber px-6 py-3 font-semibold text-onyx hover:bg-amber-dark transition-colors"
          >
            Explorar produtos
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-cream min-h-screen">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="font-display text-3xl font-black text-onyx mb-8">
          Carrinho ({count()} {count() === 1 ? 'item' : 'itens'})
        </h1>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Lista de itens */}
          <div className="lg:col-span-2 space-y-4">
            {items.map((item) => (
              <div
                key={item.variantId}
                className="flex gap-4 rounded-xl border border-sand-dark bg-white p-4"
              >
                <div className="w-20 h-20 rounded-lg overflow-hidden bg-sand shrink-0">
                  {item.thumbnail ? (
                    <Image
                      src={item.thumbnail}
                      alt={item.title}
                      width={80}
                      height={80}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🛍️</div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-onyx text-sm leading-tight line-clamp-2">
                    {item.title}
                  </h3>
                  {item.variantTitle !== 'Padrão' && (
                    <p className="text-xs text-onyx/50 mt-0.5">{item.variantTitle}</p>
                  )}
                  <p className="font-display font-bold text-terracotta mt-1">
                    {formatPrice(item.price)}
                  </p>

                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                      className="w-7 h-7 rounded-full border border-sand-dark flex items-center justify-center hover:border-amber transition-colors"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="text-sm font-semibold w-4 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                      className="w-7 h-7 rounded-full border border-sand-dark flex items-center justify-center hover:border-amber transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                    </button>

                    <button
                      onClick={() => removeItem(item.variantId)}
                      className="ml-auto text-onyx/30 hover:text-terracotta transition-colors"
                      aria-label="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Resumo */}
          <div>
            <div className="rounded-xl border border-sand-dark bg-white p-6 sticky top-20">
              <h2 className="font-display font-black text-onyx mb-4">Resumo</h2>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-onyx/60">Subtotal</span>
                  <span className="font-semibold">{formatPrice(subtotal())}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-onyx/60">Frete</span>
                  <span className="text-onyx/40">calculado no checkout</span>
                </div>
              </div>

              <div className="border-t border-sand-dark mt-4 pt-4 flex justify-between font-display font-black text-lg">
                <span>Total</span>
                <span>{formatPrice(subtotal())}</span>
              </div>

              <Link
                href="/checkout"
                className="mt-6 block w-full text-center rounded-xl bg-amber px-6 py-4 font-display font-bold text-onyx hover:bg-amber-dark transition-colors"
              >
                Finalizar compra
              </Link>

              <Link
                href="/produtos"
                className="mt-3 block w-full text-center text-sm text-onyx/50 hover:text-amber transition-colors"
              >
                Continuar comprando
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
