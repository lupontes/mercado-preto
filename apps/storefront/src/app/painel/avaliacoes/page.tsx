'use client'

import { useEffect, useState } from 'react'
import { getSellerReviews, updateReviewStatus } from '@/lib/seller-api'
import { Loader2, Star, Check, X } from 'lucide-react'

type Review = {
  id: string
  productId: string
  rating: number
  comment: string | null
  reviewerName: string
  created_at: string
}

export default function AvaliacoesPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await getSellerReviews()
      setReviews(data.reviews as Review[])
    } finally {
      setLoading(false)
    }
  }

  async function act(id: string, status: 'published' | 'rejected') {
    setError('')
    setActingId(id)
    try {
      await updateReviewStatus(id, status)
      setReviews((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar avaliação')
    } finally {
      setActingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black text-onyx">Avaliações</h1>
        <p className="text-onyx/50 text-sm mt-1">Aprove ou rejeite avaliações antes de publicá-las</p>
      </div>

      {error && (
        <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {reviews.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-dark p-12 text-center">
          <Star className="h-12 w-12 text-onyx/20 mx-auto mb-4" />
          <p className="font-display font-bold text-onyx">Nenhuma avaliação pendente</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-xl border border-sand-dark p-5">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`h-4 w-4 ${n <= review.rating ? 'fill-amber text-amber' : 'text-sand-dark'}`} />
                ))}
              </div>
              {review.comment && <p className="text-onyx/70 text-sm mt-2">{review.comment}</p>}
              <p className="text-xs text-onyx/40 mt-1">{review.reviewerName}</p>
              <div className="flex gap-2 mt-3">
                <button
                  disabled={actingId === review.id}
                  onClick={() => act(review.id, 'published')}
                  className="flex items-center gap-1 rounded-lg bg-forest/10 text-forest px-3 py-1.5 text-sm font-semibold hover:bg-forest/20 transition-colors disabled:opacity-50"
                >
                  <Check className="h-4 w-4" /> Aprovar
                </button>
                <button
                  disabled={actingId === review.id}
                  onClick={() => act(review.id, 'rejected')}
                  className="flex items-center gap-1 rounded-lg bg-terracotta/10 text-terracotta px-3 py-1.5 text-sm font-semibold hover:bg-terracotta/20 transition-colors disabled:opacity-50"
                >
                  <X className="h-4 w-4" /> Rejeitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
