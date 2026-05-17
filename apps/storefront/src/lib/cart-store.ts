'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type CartItem = {
  productId: string
  variantId: string
  title: string
  variantTitle: string
  thumbnail?: string
  price: number
  quantity: number
}

export type ShippingRate = {
  id: string
  name: string
  company: string
  price: number
  currency: string
  delivery_time: string
}

type CartStore = {
  items: CartItem[]
  selectedShipping: ShippingRate | null

  addItem: (item: Omit<CartItem, 'quantity'>) => void
  removeItem: (variantId: string) => void
  updateQuantity: (variantId: string, quantity: number) => void
  setShipping: (rate: ShippingRate | null) => void
  clear: () => void

  subtotal: () => number
  total: () => number
  count: () => number
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      selectedShipping: null,

      addItem: (item) => {
        set((state) => {
          const existing = state.items.find((i) => i.variantId === item.variantId)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.variantId === item.variantId ? { ...i, quantity: i.quantity + 1 } : i
              ),
            }
          }
          return { items: [...state.items, { ...item, quantity: 1 }] }
        })
      },

      removeItem: (variantId) => {
        set((state) => ({ items: state.items.filter((i) => i.variantId !== variantId) }))
      },

      updateQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(variantId)
          return
        }
        set((state) => ({
          items: state.items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
        }))
      },

      setShipping: (rate) => set({ selectedShipping: rate }),

      clear: () => set({ items: [], selectedShipping: null }),

      subtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

      total: () => {
        const { subtotal, selectedShipping } = get()
        return subtotal() + (selectedShipping?.price ?? 0)
      },

      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    {
      name: 'mercado-preto-cart',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, clear: () => {}, key: () => null } as Storage)
      ),
      skipHydration: true,
    }
  )
)
