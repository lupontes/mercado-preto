/**
 * The seller row carries credentials and personal/banking data (passwordHash,
 * cpfCnpj, email, pixKey, bank details...). Every public store response that
 * lists sellers must go through this projection so the routes cannot drift
 * apart and a new private column is never exposed by default.
 */
export type PublicSeller = {
  id: string
  name: string
  bio: string | null
  location: string | null
  category: string | null
  status: string
  created_at: Date | string | undefined
}

type SellerLike = {
  id: string
  name: string
  bio?: string | null
  location?: string | null
  category?: string | null
  status: string
  created_at?: Date | string
}

export function toPublicSeller(seller: SellerLike): PublicSeller {
  return {
    id: seller.id,
    name: seller.name,
    bio: seller.bio ?? null,
    location: seller.location ?? null,
    category: seller.category ?? null,
    status: seller.status,
    created_at: seller.created_at,
  }
}
