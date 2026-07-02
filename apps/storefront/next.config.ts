import type { NextConfig } from 'next'

// Imagens de produto re-hospedadas pelo Medusa (file module local) são servidas
// pelo próprio backend em NEXT_PUBLIC_MEDUSA_URL — precisa estar liberado aqui
// além do bucket S3/DO usado por outros assets, senão next/image derruba a página.
const medusaUrl = process.env.NEXT_PUBLIC_MEDUSA_URL
  ? new URL(process.env.NEXT_PUBLIC_MEDUSA_URL)
  : undefined

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.digitaloceanspaces.com' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // Túnel ngrok usado em dev local quando o backend precisa de uma URL
      // pública (ex: BACKEND_URL para o file module / webhooks MercadoPago).
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
