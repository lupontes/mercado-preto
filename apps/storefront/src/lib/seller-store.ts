'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type SellerProfile = {
  id: string
  name: string
  email: string
  status: string
  ownerName?: string
  bio?: string
  location?: string
  category?: string
}

export type SellerBanking = {
  pixKey?: string
  pixKeyType?: string
  bankName?: string
  bankAgency?: string
  bankAccount?: string
  bankAccountType?: string
}

type SellerStore = {
  token: string | null
  seller: SellerProfile | null
  login: (token: string, seller: SellerProfile) => void
  updateSeller: (seller: Partial<SellerProfile>) => void
  logout: () => void
  isAuthenticated: () => boolean
}

export const useSellerStore = create<SellerStore>()(
  persist(
    (set, get) => ({
      token: null,
      seller: null,

      login: (token, seller) => set({ token, seller }),

      updateSeller: (updates) =>
        set((state) => ({ seller: state.seller ? { ...state.seller, ...updates } : null })),

      logout: () => set({ token: null, seller: null }),

      isAuthenticated: () => !!get().token,
    }),
    {
      name: 'mercado-preto-seller',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? localStorage
          : ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, clear: () => {}, key: () => null } as Storage)
      ),
      partialize: (state) => ({
        token: state.token,
        seller: state.seller ? {
          id: state.seller.id,
          name: state.seller.name,
          email: state.seller.email,
          status: state.seller.status,
          ownerName: state.seller.ownerName,
          bio: state.seller.bio,
          location: state.seller.location,
          category: state.seller.category,
        } : null,
      }),
      skipHydration: true,
    }
  )
)
