'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { getSellerProducts, updateSellerProduct } from '@/lib/seller-api'
import { ArrowLeft, Loader2 } from 'lucide-react'

type ProductForm = {
  title: string
  description: string
  status: 'draft' | 'published'
  thumbnail: string
  price: string
}

export default function EditarProdutoPage() {
  const { token } = useSellerStore()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [form, setForm] = useState<ProductForm>({
    title: '',
    description: '',
    status: 'draft',
    thumbnail: '',
    price: '',
  })
  const [variantId, setVariantId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !id) return
    getSellerProducts(token)
      .then((data) => {
        const products = data.products as any[]
        const product = products.find((p) => p.id === id)
        if (!product) {
          router.replace('/painel/produtos')
          return
        }
        const price = product.variants?.[0]?.prices?.find((p: any) => p.currency_code === 'brl')
        setVariantId(product.variants?.[0]?.id ?? null)
        setForm({
          title: product.title ?? '',
          description: product.description ?? '',
          status: product.status ?? 'draft',
          thumbnail: product.thumbnail ?? '',
          price: price ? String(price.amount / 100).replace('.', ',') : '',
        })
      })
      .finally(() => setLoadingData(false))
  }, [token, id, router])

  function set(field: keyof ProductForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !id) return
    setError('')
    setSaving(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await updateSellerProduct(token, id, {
        title: form.title,
        description: form.description || undefined,
        status: form.status,
        thumbnail: form.thumbnail || undefined,
        variants: variantId
          ? [{ id: variantId, prices: [{ amount: priceAmount, currency_code: 'brl' }] }]
          : undefined,
      })

      router.push('/painel/produtos')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar produto')
    } finally {
      setSaving(false)
    }
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/painel/produtos" className="text-onyx/40 hover:text-amber transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-black text-onyx">Editar produto</h1>
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
          <Field label="Visibilidade">
            <select value={form.status} onChange={(e) => set('status', e.target.value as 'draft' | 'published')} className="input">
              <option value="draft">Rascunho</option>
              <option value="published">Publicado</option>
            </select>
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
            disabled={saving}
            className="flex-1 rounded-xl bg-amber py-2.5 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar alterações
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
