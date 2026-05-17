import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.digitaloceanspaces.com' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
    ],
  },
}

export default nextConfig
