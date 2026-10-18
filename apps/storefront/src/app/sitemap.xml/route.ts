// The backend builds the sitemap, but its /store routes need the publishable
// key header, which crawlers never send; this route fetches it server-side.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const backend = (process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000').replace(/\/$/, '')
  try {
    const res = await fetch(`${backend}/store/sitemap`, {
      headers: { 'x-publishable-api-key': process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? '' },
      cache: 'no-store',
    })
    if (!res.ok) return new Response('Sitemap indisponível', { status: 503 })
    return new Response(await res.text(), {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  } catch {
    return new Response('Sitemap indisponível', { status: 503 })
  }
}
