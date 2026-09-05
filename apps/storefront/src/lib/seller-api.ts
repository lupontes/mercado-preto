const BASE_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

async function sellerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'Erro ao fazer login')
  return body as { seller: { id: string; name: string; email: string; status: string } }
}

export async function sellerLogout() {
  await fetch(`${BASE_URL}/store/sellers/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-publishable-api-key': PUB_KEY },
  })
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

export async function getMe() {
  return sellerFetch<{ seller: Record<string, unknown> }>('/seller/me')
}

export async function patchMe(data: Record<string, unknown>) {
  return sellerFetch<{ seller: Record<string, unknown> }>('/seller/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getDashboard() {
  return sellerFetch<{
    stats: {
      totalOrders: number
      pendingOrders: number
      productCount: number
      totalRevenue: number
      pendingPayout: number
    }
  }>('/seller/dashboard')
}

export async function getSellerProducts(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{ products: unknown[]; count: number }>(`/seller/products?${qs}`)
}

export async function getSellerProduct(id: string) {
  return sellerFetch<{ product: Record<string, unknown> }>(`/seller/products/${id}`)
}

export async function createSellerProduct(data: Record<string, unknown>) {
  return sellerFetch<{ product: Record<string, unknown> }>('/seller/products', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateSellerProduct(id: string, data: Record<string, unknown>) {
  return sellerFetch<{ product: Record<string, unknown> }>(`/seller/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteSellerProduct(id: string) {
  return sellerFetch<void>(`/seller/products/${id}`, { method: 'DELETE' })
}

export async function getSellerOrders(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{ orders: unknown[]; count: number }>(`/seller/orders?${qs}`)
}

export async function getSellerCommissions(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{
    commissions: unknown[]
    totals: { grossAmount: number; commissionAmount: number; sellerPayout: number }
    count: number
  }>(`/seller/commissions?${qs}`)
}
