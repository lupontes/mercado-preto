'use client'

import { useState } from 'react'
import { AddToCartButton } from '@/components/cart/AddToCartButton'
import { formatPrice } from '@/lib/api'
import type { SanitizedHtml } from '@/lib/sanitize'

type Variant = {
  id: string
  title: string
  prices?: Array<{ amount: number; currency_code: string }>
}

type Props = {
  productId: string
  title: string
  /** Must come from sanitizeDescriptionHtml() — the SanitizedHtml type rejects a raw string here. */
  descriptionHtml?: SanitizedHtml
  thumbnail?: string
  variants: Variant[]
}

export function ProductDetails({ productId, title, descriptionHtml, thumbnail, variants }: Props) {
  const [selectedVariant, setSelectedVariant] = useState<Variant>(variants[0])

  const price = selectedVariant?.prices?.find((p) => p.currency_code === 'brl')

  return (
    <>
      {price && (
        <p className="font-display text-3xl font-bold text-terracotta mt-6">
          {formatPrice(price.amount)}
        </p>
      )}

      {descriptionHtml && (
        <div
          className="text-onyx/70 mt-6 leading-relaxed space-y-3 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_img]:max-w-full [&_img]:rounded-lg"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      {variants.length > 1 && (
        <div className="mt-6">
          <p className="text-sm font-semibold text-onyx mb-3">Variações</p>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVariant(v)}
                className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                  selectedVariant?.id === v.id
                    ? 'border-amber bg-amber/10 font-semibold text-onyx'
                    : 'border-sand-dark hover:border-amber text-onyx/70'
                }`}
              >
                {v.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <AddToCartButton
          productId={productId}
          variantId={selectedVariant?.id ?? ''}
          title={title}
          variantTitle={selectedVariant?.title ?? 'Padrão'}
          thumbnail={thumbnail}
          price={price?.amount ?? 0}
        />
      </div>

      <p className="text-xs text-onyx/40 mt-4 text-center">
        Venda realizada por um afroemprendedor do Mercado Preto
      </p>
    </>
  )
}
