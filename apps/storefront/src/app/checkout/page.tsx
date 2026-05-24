'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCartStore, type ShippingRate } from '@/lib/cart-store'
import { formatPrice } from '@/lib/api'
import { ChevronRight, Loader2, Truck, CreditCard, MapPin } from 'lucide-react'

const MercadoPagoBrick = dynamic(
  () => import('@/components/payment/MercadoPagoBrick'),
  { ssr: false, loading: () => <p className="text-sm text-onyx/50">Carregando formulário de pagamento...</p> }
)

const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

type Step = 'address' | 'shipping' | 'payment'

type Address = {
  firstName: string
  lastName: string
  email: string
  phone: string
  cep: string
  address1: string
  address2: string
  city: string
  state: string
}

type PreferenceData = {
  preferenceId: string
  externalReference: string
}

const EMPTY_ADDRESS: Address = {
  firstName: '', lastName: '', email: '', phone: '',
  cep: '', address1: '', address2: '', city: '', state: '',
}

async function fetchCep(cep: string) {
  const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
  if (!res.ok) return null
  const data = await res.json()
  if (data.erro) return null
  return data
}

async function fetchShippingRates(cep: string): Promise<ShippingRate[]> {
  const res = await fetch(`${MEDUSA_URL}/store/shipping/estimate?cep=${cep}`, {
    headers: { 'x-publishable-api-key': PUB_KEY },
  })
  if (!res.ok) return []
  const { rates } = await res.json()
  return rates ?? []
}

async function createPreference(
  items: { title: string; quantity: number; price: number; variantId?: string }[],
  address: Address,
  shipping: ShippingRate
): Promise<PreferenceData | null> {
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0) + shipping.price

  const res = await fetch(`${MEDUSA_URL}/store/checkout/preference`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
    body: JSON.stringify({ items, address, shipping, total }),
  })

  if (!res.ok) return null
  const { preference_id, external_reference } = await res.json()
  return { preferenceId: preference_id, externalReference: external_reference }
}

export default function CheckoutPage() {
  const { items, subtotal, selectedShipping, setShipping, clear } = useCartStore()
  const router = useRouter()

  const [step, setStep] = useState<Step>('address')
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS)
  const [rates, setRates] = useState<ShippingRate[]>([])
  const [preferenceData, setPreferenceData] = useState<PreferenceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [error, setError] = useState('')

  const [hydrated, setHydrated] = useState(false)
  const [paid, setPaid] = useState(false)
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

  async function handleAddressSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const cep = address.cep.replace(/\D/g, '')
    const fetchedRates = await fetchShippingRates(cep)
    setRates(fetchedRates)
    setLoading(false)
    setStep('shipping')
  }

  async function handleShippingSubmit() {
    if (!selectedShipping) {
      setError('Selecione uma opção de entrega.')
      return
    }
    setError('')
    setLoading(true)

    const data = await createPreference(
      items.map((i) => ({ title: i.title, quantity: i.quantity, price: i.price, variantId: i.variantId })),
      address,
      selectedShipping
    )

    if (!data) {
      setError('Erro ao preparar o pagamento. Tente novamente.')
      setLoading(false)
      return
    }

    setPreferenceData(data)
    setLoading(false)
    setStep('payment')
  }

  function handlePaymentSuccess(paymentId: string) {
    setPaid(true)
    clear()
    router.push(`/checkout/sucesso?payment_id=${paymentId}`)
  }

  function handlePaymentError(message: string) {
    setError(message)
  }

  const totalCents = subtotal() + (selectedShipping?.price ?? 0)

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

                <Field label="Telefone / WhatsApp">
                  <input type="tel" value={address.phone} onChange={(e) => setAddress((a) => ({ ...a, phone: e.target.value }))}
                    className="input" placeholder="(11) 99999-9999" />
                </Field>

                <div className="grid grid-cols-3 gap-4">
                  <Field label="CEP" required>
                    <input
                      value={address.cep}
                      onChange={(e) => setAddress((a) => ({ ...a, cep: e.target.value }))}
                      onBlur={handleCepBlur}
                      className="input"
                      placeholder="00000-000"
                      required
                    />
                  </Field>
                  <Field label="Estado">
                    <input value={address.state} onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}
                      className="input" maxLength={2} placeholder="SP" />
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

                {rates.length === 0 ? (
                  <p className="text-onyx/50">Nenhuma opção disponível para este CEP.</p>
                ) : (
                  <div className="space-y-3">
                    {rates.map((rate) => (
                      <label
                        key={rate.id}
                        className={`flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-colors ${
                          selectedShipping?.id === rate.id
                            ? 'border-amber bg-amber/5'
                            : 'border-sand-dark hover:border-amber/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="shipping"
                          checked={selectedShipping?.id === rate.id}
                          onChange={() => setShipping(rate)}
                          className="accent-amber"
                        />
                        <div className="flex-1">
                          <p className="font-semibold text-onyx">{rate.company} — {rate.name}</p>
                          <p className="text-sm text-onyx/50">{rate.delivery_time}</p>
                        </div>
                        <p className="font-display font-bold text-onyx">{formatPrice(rate.price)}</p>
                      </label>
                    ))}
                  </div>
                )}

                {error && <p className="text-terracotta text-sm mt-3">{error}</p>}

                <div className="flex gap-3 mt-6">
                  <button onClick={() => setStep('address')}
                    className="rounded-xl border border-sand-dark px-6 py-3 font-semibold text-onyx/60 hover:border-amber transition-colors">
                    Voltar
                  </button>
                  <button onClick={handleShippingSubmit} disabled={loading}
                    className="flex-1 rounded-xl bg-amber py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Ir para pagamento
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
                  amountCents={totalCents}
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
                  <span>Frete</span>
                  <span>{formatPrice(selectedShipping.price)}</span>
                </div>
              )}
              <div className="flex justify-between font-display font-bold text-onyx pt-1">
                <span>Total</span>
                <span>{formatPrice(totalCents)}</span>
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
