'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, CheckCircle } from 'lucide-react'

const BASE_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'

function ConfigurarSenhaForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!email) router.replace('/painel/login')
  }, [email, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${BASE_URL}/store/sellers/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Erro ao configurar senha')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <CheckCircle className="mx-auto h-12 w-12 text-amber" />
        <h1 className="font-display font-black text-xl text-onyx">Senha configurada!</h1>
        <p className="text-sm text-onyx/60">
          Sua conta está pronta. Acesse o portal do vendedor para começar.
        </p>
        <Link
          href="/painel/login"
          className="block w-full rounded-xl bg-amber py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors text-center"
        >
          Acessar o portal
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="font-display font-black text-xl text-onyx mb-6">Configure sua senha</h1>

      <div>
        <label className="block text-xs font-semibold text-onyx/60 mb-1">E-mail</label>
        <input
          type="email"
          value={email}
          readOnly
          className="input bg-onyx/5 cursor-not-allowed"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-onyx/60 mb-1">Nova senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          placeholder="Mínimo 8 caracteres"
          required
          autoComplete="new-password"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-onyx/60 mb-1">Confirmar senha</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input"
          placeholder="Repita a senha"
          required
          autoComplete="new-password"
        />
      </div>

      {error && (
        <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-amber py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Salvar senha
      </button>
    </form>
  )
}

export default function ConfigurarSenhaPage() {
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

        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <Suspense fallback={<div className="h-40 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-onyx/30" /></div>}>
            <ConfigurarSenhaForm />
          </Suspense>
        </div>

        <p className="text-center text-cream/40 text-xs mt-6">
          Já tem uma senha?{' '}
          <Link href="/painel/login" className="text-amber hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  )
}
