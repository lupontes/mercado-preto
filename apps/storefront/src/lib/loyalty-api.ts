import { medusaBaseUrl } from './medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

async function post<T>(path: string, body: Record<string, string>, fallback: string): Promise<T> {
  const res = await fetch(`${medusaBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? fallback)
  return data as T
}

/** Asks for a code at the e-mail of the document's previous purchases; returns the message to show. */
export async function requestLoyaltyCode(document: string): Promise<string> {
  const data = await post<{ message: string }>('/store/loyalty/code', { document }, 'Não foi possível enviar o código.')
  return data.message
}

export async function verifyLoyaltyCode(document: string, code: string): Promise<{ token: string; balance: number }> {
  return post('/store/loyalty/verify', { document, code }, 'Código inválido ou expirado.')
}
