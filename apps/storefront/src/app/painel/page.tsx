'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PainelPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/painel/dashboard') }, [router])
  return null
}
