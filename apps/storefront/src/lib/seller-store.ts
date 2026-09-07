'use client'

import { create } from 'zustand'

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
  seller: SellerProfile | null
  setSeller: (seller: SellerProfile) => void
  updateSeller: (seller: Partial<SellerProfile>) => void
  clearSeller: () => void
}

export const useSellerStore = create<SellerStore>()((set) => ({
  seller: null,
  setSeller: (seller) => set({ seller }),
  updateSeller: (updates) =>
    set((state) => ({ seller: state.seller ? { ...state.seller, ...updates } : null })),
  clearSeller: () => set({ seller: null }),
}))
