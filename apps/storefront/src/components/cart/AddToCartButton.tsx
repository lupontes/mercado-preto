'use client'

import { ShoppingBag, Check } from 'lucide-react'
import { useState } from 'react'
import { useCartStore } from '@/lib/cart-store'

type Props = {
  productId: string
  variantId: string
  title: string
  variantTitle: string
  thumbnail?: string
  price: number
}

export function AddToCartButton({ productId, variantId, title, variantTitle, thumbnail, price }: Props) {
  const addItem = useCartStore((s) => s.addItem)
  const [added, setAdded] = useState(false)

  function handleAdd() {
    addItem({ productId, variantId, title, variantTitle, thumbnail, price })
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <button
      onClick={handleAdd}
      className={`flex items-center justify-center gap-3 rounded-xl px-8 py-4 font-display font-bold text-lg transition-colors w-full ${
        added
          ? 'bg-forest text-cream'
          : 'bg-amber text-onyx hover:bg-amber-dark'
      }`}
    >
      {added ? (
        <>
          <Check className="h-5 w-5" />
          Adicionado!
        </>
      ) : (
        <>
          <ShoppingBag className="h-5 w-5" />
          Adicionar ao carrinho
        </>
      )}
    </button>
  )
}
