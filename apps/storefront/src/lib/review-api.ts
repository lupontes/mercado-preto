// No navegador, uma chamada direta pra NEXT_PUBLIC_MEDUSA_URL (http://) a
// partir de uma página https é bloqueada como mixed content. Este módulo só
// roda client-side (avaliar produto, painel de avaliações), então usa
// sempre caminho relativo, resolvido contra a própria origem https e
// proxiado pelo nginx (location /store/).
const BASE_URL = typeof window !== "undefined" ? "" : (process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://localhost:9000")
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ""

async function reviewFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-publishable-api-key": PUB_KEY,
      ...(init?.headers as Record<string, string>),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `API ${res.status}: ${path}`)
  }
  return res.json()
}

export type ReviewInviteItem = {
  productId: string
  title: string
  thumbnail?: string
  alreadyReviewed: boolean
}

export async function getReviewInvite(token: string) {
  return reviewFetch<{ items: ReviewInviteItem[] }>(`/store/reviews/invite/${token}`)
}

export async function submitReview(input: { token: string; productId: string; rating: number; comment?: string }) {
  return reviewFetch<{ review: { id: string; status: string } }>("/store/reviews", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
