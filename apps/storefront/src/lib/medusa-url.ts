// No navegador, uma chamada direta pra NEXT_PUBLIC_MEDUSA_URL (http://) a
// partir de uma página https é bloqueada como mixed content. Server-side
// (SSR) não tem esse problema e usa a URL direta do backend; client-side usa
// caminho relativo, resolvido contra a própria origem https e proxiado pelo
// nginx (location /store/) no deploy, ou pelos rewrites do next.config.ts
// onde não há nginx na frente (dev local).
export function medusaBaseUrl(): string {
  if (typeof window !== "undefined") return ""
  return process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://localhost:9000"
}
