'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    chatwootSettings?: Record<string, unknown>
    chatwootSDK?: { run: (config: Record<string, unknown>) => void }
  }
}

export function ChatwootWidget() {
  const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_URL
  const token = process.env.NEXT_PUBLIC_CHATWOOT_TOKEN

  useEffect(() => {
    if (!baseUrl || !token) return

    window.chatwootSettings = {
      hideMessageBubble: false,
      position: 'right',
      locale: 'pt_BR',
      type: 'standard',
    }

    const script = document.createElement('script')
    script.src = `${baseUrl}/packs/js/sdk.js`
    script.defer = true
    script.async = true
    script.onload = () => {
      window.chatwootSDK?.run({ websiteToken: token, baseUrl })
    }
    document.head.appendChild(script)

    return () => {
      document.head.removeChild(script)
    }
  }, [baseUrl, token])

  return null
}
