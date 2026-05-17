'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { sellerLogin } from '@/lib/seller-api'
import { Loader2 } from 'lucide-react'

export default function PainelLoginPage() {
  const { login, isAuthenticated } = useSellerStore()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    useSellerStore.persist.rehydrate()
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated && isAuthenticated()) router.replace('/painel/dashboard')
  }, [hydrated, isAuthenticated, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, seller } = await sellerLogin(email, password)
      login(token, seller)
      router.push('/painel/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-onyx flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="font-display text-2xl font-black">
            <span className="text-amber">Mercado</span>
            <span className="text-cream"> Preto</span>
          </Link>
          <p className="text-cream/50 text-sm mt-2">Portal do Vendedor</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl p-6 shadow-xl space-y-4"
        >
          <h1 className="font-display font-black text-xl text-onyx mb-6">Entrar na sua loja</h1>

          <div>
            <label className="block text-xs font-semibold text-onyx/60 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-onyx/60 mb-1">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-amber py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Entrar
          </button>
        </form>

        <p className="text-center text-cream/40 text-xs mt-6">
          Ainda não é vendedor?{' '}
          <Link href="/vender" className="text-amber hover:underline">
            Cadastre-se
          </Link>
        </p>
      </div>
    </div>
  )
}
