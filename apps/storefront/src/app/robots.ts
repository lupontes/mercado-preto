import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return {
    // Seller panel, checkout and cart are per-user pages with nothing to index.
    rules: { userAgent: '*', allow: '/', disallow: ['/painel', '/checkout', '/carrinho'] },
    sitemap: `${site}/sitemap.xml`,
  }
}
