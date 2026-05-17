'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { createSellerProduct } from '@/lib/seller-api'
import { ArrowLeft, Loader2 } from 'lucide-react'

export default function NovoProdutoPage() {
  const { token } = useSellerStore()
  const router = useRouter()

  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'draft' as 'draft' | 'published',
    thumbnail: '',
    price: '',
    sku: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setLoading(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await createSellerProduct(token, {
        title: form.title,
        description: form.description || undefined,
        status: form.status,
        thumbnail: form.thumbnail || undefined,
        variants: [
          {
            title: 'Padrão',
            sku: form.sku || undefined,
            prices: [{ amount: priceAmount, currency_code: 'brl' }],
          },
        ],
      })

      router.push('/painel/produtos')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar produto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/painel/produtos" className="text-onyx/40 hover:text-amber transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-black text-onyx">Novo produto</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-sand-dark p-6 space-y-5">
        <Field label="Título do produto" required>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} className="input" required />
        </Field>

        <Field label="Descrição">
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="input min-h-[100px] resize-y"
            placeholder="Conte sobre o produto, materiais, técnica artesanal..."
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Preço (R$)" required>
            <input
              type="text"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              className="input"
              placeholder="0,00"
              required
            />
          </Field>
          <Field label="SKU / Código">
            <input value={form.sku} onChange={(e) => set('sku', e.target.value)} className="input" placeholder="Opcional" />
          </Field>
        </div>

        <Field label="URL da imagem principal">
          <input
            type="url"
            value={form.thumbnail}
            onChange={(e) => set('thumbnail', e.target.value)}
            className="input"
            placeholder="https://..."
          />
          <p className="text-xs text-onyx/40 mt-1">Cole a URL de uma imagem hospedada (ex: Google Drive, Imgur)</p>
        </Field>

        <Field label="Visibilidade">
          <select value={form.status} onChange={(e) => set('status', e.target.value as 'draft' | 'published')} className="input">
            <option value="draft">Rascunho (não aparece na loja)</option>
            <option value="published">Publicado (visível para clientes)</option>
          </select>
        </Field>

        {error && (
          <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <Link
            href="/painel/produtos"
            className="rounded-xl border border-sand-dark px-5 py-2.5 text-sm font-semibold text-onyx/60 hover:border-amber transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-xl bg-amber py-2.5 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar produto
          </button>
        </div>
      </form>
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
