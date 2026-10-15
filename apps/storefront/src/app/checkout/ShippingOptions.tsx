'use client'

import { useState } from 'react'
import { formatPrice } from '@/lib/api'
import type { ShippingOption, ShippingQuote, UnavailableSeller } from '@/lib/cart-store'

function unavailableMessage(u: UnavailableSeller): string {
  if (u.reason === 'oversized') {
    return `O produto ${u.productTitles.join(', ')} não pode ser enviado pelos Correios. Fale com a equipe do Mercado Preto.`
  }
  if (u.reason === 'quote_failed') {
    return `Não foi possível calcular o frete agora para os produtos da loja ${u.sellerName}.`
  }
  return `Não foi possível calcular o frete para os produtos da loja ${u.sellerName} (${u.productTitles.join(', ')}). Remova-os do carrinho para continuar.`
}

export default function ShippingOptions({
  quote, selected, onSelect, onRetry, retrying = false,
}: {
  quote: ShippingQuote
  selected: ShippingOption | null
  onSelect: (option: ShippingOption) => void
  onRetry: () => void
  retrying?: boolean
}) {
  const [showDetails, setShowDetails] = useState(false)
  const storeCount = quote.options[0]?.sellers.length ?? 0

  if (quote.unavailableSellers.length > 0) {
    return (
      <div className="space-y-3" role="alert">
        {quote.unavailableSellers.map((u) => (
          <p key={u.sellerId} className="text-terracotta text-sm">{unavailableMessage(u)}</p>
        ))}
        {quote.unavailableSellers.some((u) => u.reason === 'quote_failed') && (
          <button type="button" onClick={onRetry} disabled={retrying} className="rounded-xl border border-sand-dark px-4 py-2 text-sm font-semibold disabled:opacity-50">
            Tentar novamente
          </button>
        )}
      </div>
    )
  }

  if (quote.options.length === 0) {
    return <p className="text-onyx/50">Nenhuma opção de entrega disponível para este CEP.</p>
  }

  return (
    <div className="space-y-3">
      {quote.options.map((option) => (
        <label
          key={option.tier}
          className={`flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-colors ${
            selected?.tier === option.tier ? 'border-amber bg-amber/5' : 'border-sand-dark hover:border-amber/50'
          }`}
        >
          <input type="radio" name="shipping" checked={selected?.tier === option.tier} onChange={() => onSelect(option)} className="accent-amber" aria-label={option.label} />
          <div className="flex-1">
            <p className="font-semibold text-onyx">{option.label}</p>
            <p className="text-sm text-onyx/50">{`chega em até ${option.deliveryDays} dias úteis`}</p>
          </div>
          <p className="font-display font-bold text-onyx">{formatPrice(option.total)}</p>
        </label>
      ))}

      {storeCount > 1 && (
        <div className="text-sm text-onyx/60">
          <p>{`Seu pedido sai de ${storeCount} lojas e chega em ${storeCount} pacotes separados.`}</p>
          <button type="button" className="underline" onClick={() => setShowDetails((s) => !s)}>ver detalhes</button>
          {showDetails && selected && (
            <ul className="mt-2 space-y-1">
              {selected.sellers.map((s) => (
                <li key={s.sellerId} className="flex justify-between">
                  <span>{s.sellerName}</span>
                  <span>{formatPrice(s.price)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
