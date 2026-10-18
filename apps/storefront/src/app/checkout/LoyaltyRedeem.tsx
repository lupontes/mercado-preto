'use client'

import { useState } from 'react'
import { Gift, Loader2 } from 'lucide-react'
import { formatPrice } from '@/lib/api'
import { requestLoyaltyCode, verifyLoyaltyCode } from '@/lib/loyalty-api'

// Must match CENTS_PER_POINT on the backend (modules/loyalty/constants.ts).
const CENTS_PER_POINT = 1

export type LoyaltySelection = { redeemPoints: number; loyaltyToken: string } | null

type Props = {
  document: string
  // Upper bound shown to the buyer; the server still applies its own cap.
  maxDiscountCents: number
  onChange: (selection: LoyaltySelection) => void
}

export default function LoyaltyRedeem({ document, maxDiscountCents, onChange }: Props) {
  const [stage, setStage] = useState<'start' | 'code' | 'verified'>('start')
  const [message, setMessage] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Kept in memory only: the token proves the code was confirmed and must not outlive the page.
  const [verified, setVerified] = useState<{ token: string; balance: number } | null>(null)
  const [using, setUsing] = useState(false)

  async function sendCode() {
    setError('')
    setBusy(true)
    try {
      setMessage(await requestLoyaltyCode(document))
      setStage('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o código.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmCode() {
    setError('')
    setBusy(true)
    try {
      setVerified(await verifyLoyaltyCode(document, code))
      setStage('verified')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido ou expirado.')
    } finally {
      setBusy(false)
    }
  }

  const usableCents = verified ? Math.min(verified.balance * CENTS_PER_POINT, maxDiscountCents) : 0

  return (
    <div className="mt-6 rounded-xl border border-sand-dark p-4 space-y-3">
      <p className="flex items-center gap-2 font-semibold text-onyx">
        <Gift className="h-4 w-4 text-amber" /> Usar meus pontos
      </p>

      {stage === 'start' && (
        <button type="button" onClick={sendCode} disabled={busy} className="text-sm text-amber-dark underline disabled:opacity-50">
          Enviar código para o e-mail das compras anteriores
        </button>
      )}

      {stage === 'code' && (
        <div className="space-y-2">
          <p className="text-xs text-onyx/60">{message}</p>
          <div className="flex gap-2">
            <input
              aria-label="Código"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="input w-32"
            />
            <button type="button" onClick={confirmCode} disabled={busy || code.length !== 6}
              className="rounded-lg bg-amber px-4 text-sm font-semibold text-onyx disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
            </button>
          </div>
        </div>
      )}

      {stage === 'verified' && verified && (
        <div className="space-y-2 text-sm">
          <p className="text-onyx/70">Saldo: {formatPrice(verified.balance * CENTS_PER_POINT)}</p>
          {using ? (
            <button type="button" className="text-onyx/60 underline" onClick={() => { setUsing(false); onChange(null) }}>
              Não usar pontos
            </button>
          ) : usableCents > 0 ? (
            <button type="button" className="rounded-lg bg-amber px-4 py-2 font-semibold text-onyx"
              onClick={() => { setUsing(true); onChange({ redeemPoints: usableCents / CENTS_PER_POINT, loyaltyToken: verified.token }) }}>
              Usar {formatPrice(usableCents)}
            </button>
          ) : (
            <p className="text-onyx/50">Você ainda não tem pontos para usar.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-terracotta">{error}</p>}
    </div>
  )
}
