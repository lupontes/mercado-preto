'use client'

import { useState, useEffect } from 'react'
import { useSellerStore } from '@/lib/seller-store'
import { getMe, patchMe } from '@/lib/seller-api'
import { fetchAddressByCep, hasShippingOrigin } from '@/lib/seller-address'
import { Loader2, Check } from 'lucide-react'

type Form = {
  bio: string
  location: string
  category: string
  pixKey: string
  pixKeyType: string
  bankName: string
  bankAgency: string
  bankAccount: string
  bankAccountType: string
  addressPostalCode: string
  addressStreet: string
  addressNumber: string
  addressComplement: string
  addressDistrict: string
  addressCity: string
  addressState: string
}

const ADDRESS_KEYS = [
  'addressPostalCode', 'addressStreet', 'addressNumber', 'addressComplement',
  'addressDistrict', 'addressCity', 'addressState',
] as const

// The backend treats the address as a single block and rejects an empty one,
// so a fully blank address must be left out of the request body.
function hasAnyAddress(f: Form): boolean {
  return ADDRESS_KEYS.some((k) => f[k].trim().length > 0)
}

function omitAddress(f: Form): Partial<Form> {
  const body: Partial<Form> = { ...f }
  for (const k of ADDRESS_KEYS) delete body[k]
  return body
}

const CATEGORIES = [
  'Artesanato', 'Moda Afro', 'Gastronomia', 'Beleza Natural',
  'Arte e Cultura', 'Acessórios', 'Serviços', 'Outro',
]

export default function PerfilPage() {
  const { seller, updateSeller } = useSellerStore()
  const [form, setForm] = useState<Form>({
    bio: '', location: '', category: '',
    pixKey: '', pixKeyType: 'cpf',
    bankName: '', bankAgency: '', bankAccount: '', bankAccountType: 'checking',
    addressPostalCode: '', addressStreet: '', addressNumber: '', addressComplement: '',
    addressDistrict: '', addressCity: '', addressState: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getMe()
      .then((data) => {
        const s = data.seller as Record<string, string>
        setForm({
          bio: s.bio ?? '',
          location: s.location ?? '',
          category: s.category ?? '',
          pixKey: s.pixKey ?? '',
          pixKeyType: s.pixKeyType ?? 'cpf',
          bankName: s.bankName ?? '',
          bankAgency: s.bankAgency ?? '',
          bankAccount: s.bankAccount ?? '',
          bankAccountType: s.bankAccountType ?? 'checking',
          addressPostalCode: s.addressPostalCode ?? '',
          addressStreet: s.addressStreet ?? '',
          addressNumber: s.addressNumber ?? '',
          addressComplement: s.addressComplement ?? '',
          addressDistrict: s.addressDistrict ?? '',
          addressCity: s.addressCity ?? '',
          addressState: s.addressState ?? '',
        })
      })
      .finally(() => setLoading(false))
  }, [])

  function set(field: keyof Form, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleCepBlur() {
    const found = await fetchAddressByCep(form.addressPostalCode)
    if (!found) return
    setForm((f) => ({
      ...f,
      addressStreet: found.street,
      addressDistrict: found.district,
      addressCity: found.city,
      addressState: found.state,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const data = await patchMe(hasAnyAddress(form) ? form : omitAddress(form))
      updateSeller(data.seller as any)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar perfil')
    } finally {
      setSaving(false)
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
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black text-onyx">Meu perfil</h1>
        <p className="text-onyx/50 text-sm mt-1">
          Estas informações aparecem na sua página pública no Mercado Preto.
        </p>
      </div>

      {/* Info não editável */}
      <div className="bg-amber/5 border border-amber/20 rounded-xl p-4">
        <p className="text-xs font-semibold text-onyx/50 mb-1">Nome da loja</p>
        <p className="font-display font-bold text-onyx">{seller?.name}</p>
        <p className="text-xs text-onyx/40 mt-0.5">{seller?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Informações públicas */}
        <section className="bg-white rounded-xl border border-sand-dark p-5 space-y-4">
          <h2 className="font-display font-bold text-onyx">Informações da loja</h2>

          <Field label="Categoria">
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className="input">
              <option value="">Selecione uma categoria</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Localização (cidade/estado)">
            <input
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              className="input"
              placeholder="Ex: Cachoeira, BA"
            />
          </Field>

          <Field label="Bio da loja">
            <textarea
              value={form.bio}
              onChange={(e) => set('bio', e.target.value)}
              className="input min-h-[100px] resize-y"
              maxLength={500}
              placeholder="Conte sobre você, sua história, seu trabalho artesanal..."
            />
            <p className="text-xs text-onyx/40 mt-1">{form.bio.length}/500 caracteres</p>
          </Field>
        </section>

        {/* Endereço de envio */}
        <section className="bg-white rounded-xl border border-sand-dark p-5 space-y-4">
          <h2 className="font-display font-bold text-onyx">Endereço de envio</h2>
          <p className="text-xs text-onyx/50">
            De onde seus produtos saem. O frete é calculado a partir deste endereço.
          </p>

          {!hasShippingOrigin(form) && (
            <p className="text-sm text-onyx bg-amber/10 border border-amber/30 rounded-lg px-3 py-2">
              Seus produtos não podem ser vendidos até o endereço de envio estar completo.
            </p>
          )}

          <div className="grid grid-cols-3 gap-4">
            <Field label="CEP" htmlFor="addressPostalCode">
              <input
                id="addressPostalCode"
                value={form.addressPostalCode}
                onChange={(e) => set('addressPostalCode', e.target.value)}
                onBlur={handleCepBlur}
                className="input"
                inputMode="numeric"
                placeholder="00000-000"
              />
            </Field>
          </div>

          <Field label="Rua" htmlFor="addressStreet">
            <input id="addressStreet" value={form.addressStreet} onChange={(e) => set('addressStreet', e.target.value)} className="input" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Número" htmlFor="addressNumber">
              <input id="addressNumber" value={form.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} className="input" />
            </Field>
            <Field label="Complemento" htmlFor="addressComplement">
              <input id="addressComplement" value={form.addressComplement} onChange={(e) => set('addressComplement', e.target.value)} className="input" />
            </Field>
          </div>

          <Field label="Bairro" htmlFor="addressDistrict">
            <input id="addressDistrict" value={form.addressDistrict} onChange={(e) => set('addressDistrict', e.target.value)} className="input" />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="Cidade" htmlFor="addressCity">
                <input id="addressCity" value={form.addressCity} onChange={(e) => set('addressCity', e.target.value)} className="input" />
              </Field>
            </div>
            <Field label="UF" htmlFor="addressState">
              <input id="addressState" value={form.addressState} onChange={(e) => set('addressState', e.target.value.toUpperCase())} className="input" maxLength={2} />
            </Field>
          </div>
        </section>

        {/* Dados bancários / PIX */}
        <section className="bg-white rounded-xl border border-sand-dark p-5 space-y-4">
          <h2 className="font-display font-bold text-onyx">Dados para recebimento</h2>
          <p className="text-xs text-onyx/50">
            Utilizados para os repasses das suas vendas. Mantidos com segurança.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Tipo de chave PIX">
              <select value={form.pixKeyType} onChange={(e) => set('pixKeyType', e.target.value)} className="input">
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="phone">Telefone</option>
                <option value="random">Chave aleatória</option>
              </select>
            </Field>
            <Field label="Chave PIX">
              <input value={form.pixKey} onChange={(e) => set('pixKey', e.target.value)} className="input" />
            </Field>
          </div>

          <Field label="Banco">
            <input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} className="input" placeholder="Ex: Nubank, Banco do Brasil..." />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Agência">
              <input value={form.bankAgency} onChange={(e) => set('bankAgency', e.target.value)} className="input" />
            </Field>
            <Field label="Conta">
              <input value={form.bankAccount} onChange={(e) => set('bankAccount', e.target.value)} className="input" />
            </Field>
            <Field label="Tipo de conta">
              <select value={form.bankAccountType} onChange={(e) => set('bankAccountType', e.target.value)} className="input">
                <option value="checking">Corrente</option>
                <option value="savings">Poupança</option>
              </select>
            </Field>
          </div>
        </section>

        {error && (
          <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className={`w-full rounded-xl py-3 font-display font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
            success ? 'bg-forest text-cream' : 'bg-amber text-onyx hover:bg-amber-dark'
          }`}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : success ? <Check className="h-4 w-4" /> : null}
          {success ? 'Perfil salvo!' : 'Salvar perfil'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-onyx/60 mb-1">{label}</label>
      {children}
    </div>
  )
}
