import type { NextConfig } from 'next'

type RemotePattern = { protocol: 'http' | 'https'; hostname: string; port?: string }

function remotePatternFor(rawUrl: string | undefined): RemotePattern[] {
  if (!rawUrl) return []
  const url = new URL(rawUrl)
  return [
    {
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
    },
  ]
}

const backendUrl = (process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000').replace(/\/$/, '')

const nextConfig: NextConfig = {
  output: 'standalone',
  // Browser code calls the backend through same-origin relative paths (see
  // src/lib/medusa-url.ts). When deployed, nginx proxies /store and /seller
  // before requests ever reach Next.js, so these rewrites only matter where
  // there is no nginx in front — local dev, or hitting the storefront port
  // directly — and keep those setups working instead of returning 404.
  async rewrites() {
    return [
      { source: '/store/:path*', destination: `${backendUrl}/store/:path*` },
      { source: '/seller/:path*', destination: `${backendUrl}/seller/:path*` },
    ]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.digitaloceanspaces.com' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // ngrok tunnel used in local dev when the backend needs a public URL
      // (e.g. BACKEND_URL for the file module / MercadoPago webhooks).
      { protocol: 'https', hostname: '*.ngrok-free.dev' },
      // Product images uploaded through Medusa's local file module are stored
      // with BACKEND_URL as their base. Locally that is the backend itself
      // (NEXT_PUBLIC_MEDUSA_URL); when deployed it is the public site behind
      // nginx (<site>/api/static), a different host from the backend URL that
      // SSR uses. Either one missing makes next/image reject the image (400).
      ...remotePatternFor(process.env.NEXT_PUBLIC_MEDUSA_URL),
      ...remotePatternFor(process.env.NEXT_PUBLIC_SITE_URL),
    ],
  },
}

export default nextConfig
