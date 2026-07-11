import type { NextConfig } from 'next'

// Product images re-hosted by Medusa's local file module are served by the
// backend itself at NEXT_PUBLIC_MEDUSA_URL — that host needs to be allowed
// here in addition to the S3/DO bucket used for other assets, or next/image
// crashes the page.
const medusaUrl = process.env.NEXT_PUBLIC_MEDUSA_URL
  ? new URL(process.env.NEXT_PUBLIC_MEDUSA_URL)
  : undefined

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.digitaloceanspaces.com' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // ngrok tunnel used in local dev when the backend needs a public URL
      // (e.g. BACKEND_URL for the file module / MercadoPago webhooks).
      { protocol: 'https', hostname: '*.ngrok-free.dev' },
      ...(medusaUrl
        ? [
            {
              protocol: medusaUrl.protocol.replace(':', '') as 'http' | 'https',
              hostname: medusaUrl.hostname,
              ...(medusaUrl.port ? { port: medusaUrl.port } : {}),
            },
          ]
        : []),
    ],
  },
}

export default nextConfig
