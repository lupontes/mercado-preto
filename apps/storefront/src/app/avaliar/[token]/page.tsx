'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { getReviewInvite, submitReview, type ReviewInviteItem } from '@/lib/review-api'
import { Star, Loader2, Check } from 'lucide-react'

export default function AvaliarPage() {
  const { token } = useParams<{ token: string }>()
  const [items, setItems] = useState<ReviewInviteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getReviewInvite(token)
      .then((data) => setItems(data.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Erro ao carregar avaliação'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  if (error) {
    return <p className="text-center text-terracotta py-12">{error}</p>
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <h1 className="font-display text-2xl font-black text-onyx">Avalie sua compra</h1>
      {items.map((item) => (
        <ReviewCard
          key={item.productId}
          item={item}
          token={token}
          onSubmitted={() =>
            setItems((prev) =>
              prev.map((i) => (i.productId === item.productId ? { ...i, alreadyReviewed: true } : i))
            )
          }
        />
      ))}
    </div>
  )
}

function ReviewCard({
  item,
  token,
  onSubmitted,
}: {
  item: ReviewInviteItem
  token: string
  onSubmitted: () => void
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setSaving(true)
    try {
      await submitReview({ token, productId: item.productId, rating, comment: comment || undefined })
      onSubmitted()
    } finally {
      setSaving(false)
    }
  }

  if (item.alreadyReviewed) {
    return (
      <div className="bg-white rounded-xl border border-sand-dark p-5 flex items-center gap-3 text-forest">
        <Check className="h-5 w-5" />
        <p className="font-semibold">{item.title}</p>
        <span className="ml-auto text-sm">Avaliado ✓</span>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-sand-dark p-5 space-y-3">
      <p className="font-display font-bold text-onyx">{item.title}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
            onClick={() => setRating(n)}
          >
            <Star className={`h-6 w-6 ${n <= rating ? 'fill-amber text-amber' : 'text-sand-dark'}`} />
          </button>
        ))}
      </div>
      <label className="block text-xs font-semibold text-onyx/60" htmlFor={`comment-${item.productId}`}>
        Comentário (opcional)
      </label>
      <textarea
        id={`comment-${item.productId}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="input min-h-[80px]"
        maxLength={1000}
      />
      <button
        type="button"
        disabled={rating === 0 || saving}
        onClick={handleSubmit}
        className="rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50"
      >
        Enviar avaliação
      </button>
    </div>
  )
}
