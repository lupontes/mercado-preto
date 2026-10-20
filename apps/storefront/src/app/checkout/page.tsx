'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCartStore, type ShippingQuote } from '@/lib/cart-store'
import { formatPrice } from '@/lib/api'
import { maskDocument, validateDocument } from '@/lib/document'
import { ChevronRight, Loader2, Truck, CreditCard, MapPin } from 'lucide-react'
import PaymentMethodSelector, { type PaymentMethod } from '@/components/payment/PaymentMethodSelector'
import { fetchTestCashEnabled } from '@/lib/test-cash'
import { createTestCashOrder } from './create-test-cash-order'
import { createPreference, type Address, type CheckoutItem, type PreferenceData } from './create-preference'
import LoyaltyRedeem, { type LoyaltySelection } from './LoyaltyRedeem'
import { CENTS_PER_POINT } from '@/lib/loyalty'
import { fetchShippingQuote, shippingQuoteErrorMessage } from './shipping-quote'
import ShippingOptions from './ShippingOptions'

const MercadoPagoBrick = dynamic(
  () => import('@/components/payment/MercadoPagoBrick'),
  { ssr: false, loading: () => <p className="text-sm text-onyx/50">Carregando formulário de pagamento...</p> }
)

type Step = 'address' | 'shipping' | 'payment'

const EMPTY_ADDRESS: Address = {
  firstName: '', lastName: '', email: '', phone: '', document: '',
  cep: '', address1: '', address2: '', city: '', state: '',
}

async function fetchCep(cep: string) {
  const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
  if (!res.ok) return null
  const data = await res.json()
  if (data.erro) return null
  return data
}

export default function CheckoutPage() {
  const { items, subtotal, selectedShipping, setShipping, applyPriceChanges, clear } = useCartStore()
  const router = useRouter()

  const [step, setStep] = useState<Step>('address')
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS)
  const [quote, setQuote] = useState<ShippingQuote | null>(null)
  const [preferenceData, setPreferenceData] = useState<PreferenceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [error, setError] = useState('')
  const [loyalty, setLoyalty] = useState<LoyaltySelection>(null)

  const [hydrated, setHydrated] = useState(false)
  const [paid, setPaid] = useState(false)
  const [testCashEnabled, setTestCashEnabled] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago')

  useEffect(() => {
    let active = true
    fetchTestCashEnabled().then((enabled) => {
      if (active) setTestCashEnabled(enabled)
    })
    return () => { active = false }
  }, [])

  const isTestCash = testCashEnabled && paymentMethod === 'test_cash'
  useEffect(() => {
    useCartStore.persist.rehydrate()
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated && items.length === 0 && !paid) router.replace('/carrinho')
  }, [hydrated, items.length, router, paid])

  async function handleCepBlur() {
    const cep = address.cep.replace(/\D/g, '')
    if (cep.length !== 8) return
    setCepLoading(true)
    const data = await fetchCep(cep)
    if (data) {
      setAddress((a) => ({
        ...a,
        address1: data.logradouro ?? a.address1,
        city: data.localidade ?? a.city,
        state: data.uf ?? a.state,
      }))
    }
    setCepLoading(false)
  }

  async function loadQuote() {
    const q = await fetchShippingQuote(
      address.cep.replace(/\D/g, ''),
      items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }))
    )
    setQuote(q)
    // Keep the buyer's tier when it is still offered; a blocked quote clears it.
    setShipping(
      q.unavailableSellers.length === 0
        ? q.options.find((o) => o.tier === selectedShipping?.tier) ?? q.options[0] ?? null
        : null
    )
  }

  async function handleRetryQuote() {
    setError('')
    setLoading(true)
    try {
      await loadQuote()
    } catch (err) {
      setError(shippingQuoteErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleAddressSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!validateDocument(address.document).valid) {
      setError('CPF ou CNPJ inválido. Confira os números digitados.')
      return
    }

    setLoading(true)

    try {
      await loadQuote()
      setStep('shipping')
    } catch (err) {
      setError(shippingQuoteErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  function checkoutItems(): CheckoutItem[] {
    return items.map((i) => ({
      title: i.title,
      quantity: i.quantity,
      price: i.price,
      variantId: i.variantId,
      productId: i.productId,
    }))
  }

  async function handleShippingSubmit() {
    if (!selectedShipping) {
      setError('Selecione uma opção de entrega.')
      return
    }
    setError('')
    setLoading(true)

    const result = isTestCash
      ? await createTestCashOrder(checkoutItems(), address, selectedShipping)
      : await createPreference(checkoutItems(), address, selectedShipping, loyalty ?? undefined)

    if (!result.ok) {
      if (result.status === 409 && result.priceChanges) {
        // Catalog prices moved since the item was added: adopt them and let the buyer re-confirm.
        applyPriceChanges(result.priceChanges)
        setError('O preço de alguns produtos foi atualizado. Confira e continue.')
      } else if (result.status === 409 && result.quote) {
        // The price moved since the buyer chose: show the new one and let them confirm.
        setQuote(result.quote)
        const updated = result.quote.options.find((o) => o.tier === selectedShipping.tier) ?? null
        setShipping(updated)
        setError(updated ? `O valor do frete foi atualizado para ${formatPrice(updated.total)}. Confira e continue.` : result.error)
      } else if (result.status === 422 && result.quote) {
        setQuote(result.quote)
        // With a single choice left and every store shipping, there is nothing to
        // decide; the buyer only needs to confirm the new option.
        const [only, ...rest] = result.quote.options
        if (only && rest.length === 0 && result.quote.unavailableSellers.length === 0) {
          setShipping(only)
          setError('As opções de frete mudaram. Confira e continue.')
        } else {
          setShipping(null)
          setError(result.error)
        }
      } else {
        setError(isTestCash ? 'Erro ao criar o pedido de teste. Tente novamente.' : 'Erro ao preparar o pagamento. Tente novamente.')
      }
      setLoading(false)
      return
    }

    if (isTestCash) {
      setPaid(true)
      clear()
      router.push(`/checkout/sucesso?test_cash=${encodeURIComponent((result.data as { externalReference: string }).externalReference)}`)
      return
    }

    setPreferenceData(result.data as PreferenceData)
    setLoading(false)
    setStep('payment')
  }

  function handlePaymentSuccess(paymentId: string) {
    // Same rule as the backend credit: 1 point per R$1 paid in products, shipping excluded.
    const points = Math.floor((subtotal() - (preferenceData?.discountCents ?? 0)) / 100)
    setPaid(true)
    clear()
    router.push(`/checkout/sucesso?payment_id=${paymentId}${points > 0 ? `&pontos=${points}` : ''}`)
  }

  function handlePaymentError(message: string) {
    setError(message)
  }

  // Until the server confirms the discount with the preference, show the one the buyer chose.
  const discountCents = preferenceData ? preferenceData.discountCents ?? 0 : (loyalty?.redeemPoints ?? 0) * CENTS_PER_POINT
  const totalCents = subtotal() + (selectedShipping?.total ?? 0) - discountCents

  const steps: { id: Step; label: string; icon: React.ReactNode }[] = [
    { id: 'address', label: 'Endereço', icon: <MapPin className="h-4 w-4" /> },
    { id: 'shipping', label: 'Entrega', icon: <Truck className="h-4 w-4" /> },
    { id: 'payment', label: 'Pagamento', icon: <CreditCard className="h-4 w-4" /> },
  ]

  const stepIndex = steps.findIndex((s) => s.id === step)

  return (
    <div className="bg-cream min-h-screen">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10">
        <Link href="/carrinho" className="text-sm text-onyx/50 hover:text-amber transition-colors mb-6 inline-block">
          ← Voltar ao carrinho
        </Link>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                i === stepIndex
                  ? 'bg-amber text-onyx'
                  : i < stepIndex
                  ? 'bg-forest/20 text-forest'
                  : 'bg-sand-dark/50 text-onyx/30'
              }`}>
                {s.icon}
                {s.label}
              </div>
              {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-onyx/20" />}
            </div>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">

            {/* Endereço */}
            {step === 'address' && (
              <form onSubmit={handleAddressSubmit} className="bg-white rounded-2xl border border-sand-dark p-6 space-y-4">
                <h2 className="font-display font-black text-xl text-onyx mb-6">Dados de entrega</h2>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Nome" required>
                    <input value={address.firstName} onChange={(e) => setAddress((a) => ({ ...a, firstName: e.target.value }))}
                      className="input" required />
                  </Field>
                  <Field label="Sobrenome" required>
                    <input value={address.lastName} onChange={(e) => setAddress((a) => ({ ...a, lastName: e.target.value }))}
                      className="input" required />
                  </Field>
                </div>

                <Field label="E-mail" required>
                  <input type="email" value={address.email} onChange={(e) => setAddress((a) => ({ ...a, email: e.target.value }))}
                    className="input" required />
                </Field>

                <Field label="CPF ou CNPJ" required>
                  <input
                    value={address.document}
                    onChange={(e) => setAddress((a) => ({ ...a, document: maskDocument(e.target.value) }))}
                    className="input"
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    required
                  />
                  <p className="text-xs text-onyx/40 mt-1">Necessário para emissão da nota fiscal.</p>
                </Field>

                <Field label="Telefone / WhatsApp">
                  <input
                    type="tel"
                    value={address.phone}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, '').slice(0, 11)
                      let masked = d
                      if (d.length > 10) masked = `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
                      else if (d.length > 6) masked = `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
                      else if (d.length > 2) masked = `(${d.slice(0,2)}) ${d.slice(2)}`
                      else if (d.length > 0) masked = `(${d}`
                      setAddress((a) => ({ ...a, phone: masked }))
                    }}
                    className="input"
                    placeholder="(11) 99999-9999"
                    inputMode="tel"
                  />
                </Field>

                <div className="grid grid-cols-3 gap-4">
                  <Field label="CEP" required>
                    <input
                      value={address.cep}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
                        const masked = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
                        setAddress((a) => ({ ...a, cep: masked }))
                      }}
                      onBlur={handleCepBlur}
                      className="input"
                      placeholder="00000-000"
                      inputMode="numeric"
                      required
                    />
                  </Field>
                  <Field label="Estado">
                    <input
                      value={address.state}
                      onChange={(e) => {
                        const letters = e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase()
                        setAddress((a) => ({ ...a, state: letters }))
                      }}
                      className="input"
                      placeholder="SP"
                    />
                  </Field>
                  <Field label="Cidade">
                    <input value={address.city} onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                      className="input" />
                  </Field>
                </div>

                {cepLoading && <p className="text-xs text-onyx/40">Buscando endereço...</p>}

                <Field label="Endereço" required>
                  <input value={address.address1} onChange={(e) => setAddress((a) => ({ ...a, address1: e.target.value }))}
                    className="input" required />
                </Field>

                <Field label="Complemento">
                  <input value={address.address2} onChange={(e) => setAddress((a) => ({ ...a, address2: e.target.value }))}
                    className="input" placeholder="Apto, bloco, referência..." />
                </Field>

                {error && <p className="text-terracotta text-sm">{error}</p>}

                <button type="submit" disabled={loading}
                  className="w-full rounded-xl bg-amber py-4 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Calcular frete
                </button>
              </form>
            )}

            {/* Frete */}
            {step === 'shipping' && (
              <div className="bg-white rounded-2xl border border-sand-dark p-6">
                <h2 className="font-display font-black text-xl text-onyx mb-6">Opções de entrega</h2>

                {quote && <ShippingOptions quote={quote} selected={selectedShipping} onSelect={setShipping} onRetry={handleRetryQuote} retrying={loading} />}

                {testCashEnabled && (
                  <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
                )}

                {!isTestCash && validateDocument(address.document).valid && (
                  <LoyaltyRedeem document={address.document} maxDiscountCents={quote?.maxLoyaltyDiscountCents ?? 0} onChange={setLoyalty} />
                )}

                {error && <p className="text-terracotta text-sm mt-3">{error}</p>}

                <div className="flex gap-3 mt-6">
                  <button onClick={() => setStep('address')}
                    className="rounded-xl border border-sand-dark px-6 py-3 font-semibold text-onyx/60 hover:border-amber transition-colors">
                    Voltar
                  </button>
                  <button onClick={handleShippingSubmit} disabled={loading || !selectedShipping || (quote?.unavailableSellers.length ?? 0) > 0}
                    data-testid={isTestCash ? 'submit-test-cash' : undefined}
                    className="flex-1 rounded-xl bg-amber py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isTestCash ? 'Finalizar pedido (teste)' : 'Ir para pagamento'}
                  </button>
                </div>
              </div>
            )}

            {/* Pagamento */}
            {step === 'payment' && preferenceData && (
              <div className="bg-white rounded-2xl border border-sand-dark p-6">
                <h2 className="font-display font-black text-xl text-onyx mb-6">Pagamento</h2>

                {error && <p className="text-terracotta text-sm mb-4">{error}</p>}

                <MercadoPagoBrick
                  preferenceId={preferenceData.preferenceId}
                  externalReference={preferenceData.externalReference}
                  amountCents={preferenceData.totalCents}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                />

                <button onClick={() => setStep('shipping')}
                  className="mt-4 text-sm text-onyx/50 hover:text-onyx transition-colors">
                  ← Voltar para entrega
                </button>
              </div>
            )}
          </div>

          {/* Resumo lateral */}
          <div className="rounded-xl border border-sand-dark bg-white p-5 h-fit sticky top-20">
            <h3 className="font-display font-bold text-onyx mb-4">Seu pedido</h3>
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.variantId} className="flex gap-3 text-sm">
                  <div className="w-12 h-12 rounded-lg bg-sand shrink-0 flex items-center justify-center text-lg">
                    🛍️
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-onyx leading-tight line-clamp-2">{item.title}</p>
                    <p className="text-onyx/50">Qtd: {item.quantity}</p>
                  </div>
                  <p className="font-semibold text-onyx shrink-0">{formatPrice(item.price * item.quantity)}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-sand-dark mt-4 pt-4 space-y-1 text-sm">
              <div className="flex justify-between text-onyx/60">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal())}</span>
              </div>
              {selectedShipping && (
                <div className="flex justify-between text-onyx/60">
                  <span>{`Frete (${selectedShipping.label})`}</span>
                  <span>{formatPrice(selectedShipping.total)}</span>
                </div>
              )}
              {discountCents > 0 ? (
                <div className="flex justify-between text-forest">
                  <span>Desconto em pontos</span>
                  <span>-{formatPrice(discountCents)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-display font-bold text-onyx pt-1">
                <span>Total</span>
                <span>{formatPrice(preferenceData?.totalCents ?? totalCents)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-onyx/60 mb-1">
        {label} {required && <span className="text-terracotta">*</span>}
      </label>
      {children}
    </div>
  )
}
