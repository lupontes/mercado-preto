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

export type ShippingTier = 'economico' | 'rapido'

export type SellerShipping = {
  sellerId: string
  sellerName: string
  tier: ShippingTier
  service: 'PAC' | 'SEDEX'
  serviceId: number
  price: number
  deliveryDays: number
}

/** One choice the buyer sees: the sum of every store's PAC or SEDEX. */
export type ShippingOption = { tier: ShippingTier; label: string; total: number; deliveryDays: number; sellers: SellerShipping[] }

export type UnavailableSeller = {
  sellerId: string
  sellerName: string
  reason: 'missing_address' | 'oversized' | 'quote_failed'
  productTitles: string[]
}

export type ShippingQuote = { options: ShippingOption[]; unavailableSellers: UnavailableSeller[] }

export type PriceChange = { variantId: string; price: number; title: string }

type CartStore = {
  items: CartItem[]
  selectedShipping: ShippingOption | null

  addItem: (item: Omit<CartItem, 'quantity'>) => void
  removeItem: (variantId: string) => void
  updateQuantity: (variantId: string, quantity: number) => void
  applyPriceChanges: (changes: PriceChange[]) => void
  setShipping: (option: ShippingOption | null) => void
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
              selectedShipping: null,
            }
          }
          return { items: [...state.items, { ...item, quantity: 1 }], selectedShipping: null }
        })
      },

      removeItem: (variantId) => {
        // The cart changed, so any previous quote is stale and must be requested again.
        set((state) => ({ items: state.items.filter((i) => i.variantId !== variantId), selectedShipping: null }))
      },

      updateQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(variantId)
          return
        }
        set((state) => ({
          items: state.items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
          selectedShipping: null,
        }))
      },

      // Keeps the stored item shape untouched (only price/title are overwritten)
      // so carts persisted by older builds still hydrate. Shipping is kept: its
      // quote depends on weight and destination, not on price.
      applyPriceChanges: (changes) => {
        set((state) => ({
          items: state.items.map((i) => {
            const change = changes.find((c) => c.variantId === i.variantId)
            return change ? { ...i, price: change.price, title: change.title } : i
          }),
        }))
      },

      setShipping: (option) => set({ selectedShipping: option }),

      clear: () => set({ items: [], selectedShipping: null }),

      subtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

      total: () => {
        const { subtotal, selectedShipping } = get()
        return subtotal() + (selectedShipping?.total ?? 0)
      },

      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    {
      name: 'mercado-preto-cart',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, clear: () => {}, key: () => null } as Storage)
      ),
      skipHydration: true,
      version: 1,
      // v0 stored a single carrier rate ({ id, price, ... }). It cannot be
      // charged anymore, so the selection is dropped and the buyer re-quotes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrate: (persisted: any, version) => (version < 1 ? { ...persisted, selectedShipping: null } : persisted),
    }
  )
)
