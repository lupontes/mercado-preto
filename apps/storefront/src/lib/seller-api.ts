const BASE_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

async function sellerFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string>),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `API ${res.status}: ${path}`)
  }
  return res.json()
}

// /store/sellers/* routes sit under Medusa's global /store middleware, which
// requires this header even for the pre-auth login/set-password calls below.
export async function sellerLogin(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/store/sellers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'Erro ao fazer login')
  return body as { token: string; seller: { id: string; name: string; email: string; status: string } }
}

export async function setSellerPassword(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/store/sellers/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'Erro ao configurar senha')
  return body as { message: string }
}

export async function getMe(token: string) {
  return sellerFetch<{ seller: Record<string, unknown> }>('/seller/me', token)
}

export async function patchMe(token: string, data: Record<string, unknown>) {
  return sellerFetch<{ seller: Record<string, unknown> }>('/seller/me', token, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getDashboard(token: string) {
  return sellerFetch<{
    stats: {
      totalOrders: number
      pendingOrders: number
      productCount: number
      totalRevenue: number
      pendingPayout: number
    }
  }>('/seller/dashboard', token)
}

export async function getSellerProducts(token: string, params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{ products: unknown[]; count: number }>(`/seller/products?${qs}`, token)
}

export async function getSellerProduct(token: string, id: string) {
  return sellerFetch<{ product: Record<string, unknown> }>(`/seller/products/${id}`, token)
}

export async function createSellerProduct(token: string, data: Record<string, unknown>) {
  return sellerFetch<{ product: Record<string, unknown> }>('/seller/products', token, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateSellerProduct(token: string, id: string, data: Record<string, unknown>) {
  return sellerFetch<{ product: Record<string, unknown> }>(`/seller/products/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteSellerProduct(token: string, id: string) {
  return sellerFetch<void>(`/seller/products/${id}`, token, { method: 'DELETE' })
}

export async function getSellerOrders(token: string, params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{ orders: unknown[]; count: number }>(`/seller/orders?${qs}`, token)
}

export async function getSellerCommissions(token: string, params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{
    commissions: unknown[]
    totals: { grossAmount: number; commissionAmount: number; sellerPayout: number }
    count: number
  }>(`/seller/commissions?${qs}`, token)
}
