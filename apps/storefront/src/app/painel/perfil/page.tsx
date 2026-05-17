'use client'

import { useState, useEffect } from 'react'
import { useSellerStore } from '@/lib/seller-store'
import { getMe, patchMe } from '@/lib/seller-api'
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
}

const CATEGORIES = [
  'Artesanato', 'Moda Afro', 'Gastronomia', 'Beleza Natural',
  'Arte e Cultura', 'Acessórios', 'Serviços', 'Outro',
]

export default function PerfilPage() {
  const { token, seller, updateSeller } = useSellerStore()
  const [form, setForm] = useState<Form>({
    bio: '', location: '', category: '',
    pixKey: '', pixKeyType: 'cpf',
    bankName: '', bankAgency: '', bankAccount: '', bankAccountType: 'checking',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    getMe(token)
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
        })
      })
      .finally(() => setLoading(false))
  }, [token])

  function set(field: keyof Form, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setSaving(true)
    try {
      const data = await patchMe(token, form)
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-onyx/60 mb-1">{label}</label>
      {children}
    </div>
  )
}
