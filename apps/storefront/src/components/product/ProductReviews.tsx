import { Star } from 'lucide-react'
import type { ProductReview } from '@/lib/api'

type Props = {
  average: number | null
  count: number
  reviews: ProductReview[]
}

export function ProductReviews({ average, count, reviews }: Props) {
  return (
    <section className="mt-10 border-t border-sand-dark pt-8">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="font-display text-xl font-black text-onyx">Avaliações</h2>
        {average !== null && (
          <span className="flex items-center gap-1 text-onyx/70">
            <Star className="h-4 w-4 fill-amber text-amber" />
            {average} <span className="text-onyx/40 text-sm">({count})</span>
          </span>
        )}
      </div>

      {reviews.length === 0 ? (
        <p className="text-onyx/50 text-sm">Nenhuma avaliação ainda — seja o primeiro a avaliar depois da compra.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-xl border border-sand-dark p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`h-3.5 w-3.5 ${n <= review.rating ? 'fill-amber text-amber' : 'text-sand-dark'}`} />
                  ))}
                </div>
                <p className="text-sm font-semibold text-onyx">{review.reviewerName}</p>
              </div>
              {review.comment && <p className="text-onyx/70 text-sm">{review.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
