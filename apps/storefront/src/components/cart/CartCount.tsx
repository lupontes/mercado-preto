'use client'

import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import { useCartStore } from '@/lib/cart-store'

export function CartCount() {
  const count = useCartStore((s) => s.count())

  return (
    <Link href="/carrinho" aria-label="Carrinho" className="relative">
      <ShoppingBag className="h-6 w-6 text-cream hover:text-amber transition-colors" />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-terracotta text-cream text-[10px] font-bold flex items-center justify-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  )
}
