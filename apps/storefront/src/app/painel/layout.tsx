'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSellerStore } from '@/lib/seller-store'
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  DollarSign,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-react'

const navItems = [
  { href: '/painel/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/painel/produtos', label: 'Meus produtos', icon: Package },
  { href: '/painel/pedidos', label: 'Pedidos', icon: ShoppingBag },
  { href: '/painel/comissoes', label: 'Comissões', icon: DollarSign },
  { href: '/painel/perfil', label: 'Meu perfil', icon: User },
]

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  const { seller, token, logout, isAuthenticated } = useSellerStore()
  const router = useRouter()
  const pathname = usePathname()
  const [hydrated, setHydrated] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    useSellerStore.persist.rehydrate()
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated && !isAuthenticated() && pathname !== '/painel/login') {
      router.replace('/painel/login')
    }
  }, [hydrated, pathname, isAuthenticated, router])

  if (!hydrated) return null

  if (!isAuthenticated() && pathname !== '/painel/login') return null

  if (pathname === '/painel/login') return <>{children}</>

  function handleLogout() {
    logout()
    router.push('/painel/login')
  }

  return (
    <div className="flex min-h-screen bg-sand">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-onyx/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-onyx text-cream flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-cream/10">
          <Link href="/" className="font-display font-black text-lg">
            <span className="text-amber">Mercado</span>
            <span className="text-cream"> Preto</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-cream/60 hover:text-cream"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Seller info */}
        <div className="px-6 py-4 border-b border-cream/10">
          <div className="w-10 h-10 rounded-full bg-amber/20 flex items-center justify-center font-display font-black text-amber mb-2">
            {seller?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <p className="text-sm font-semibold text-cream leading-tight truncate">{seller?.name}</p>
          <p className="text-xs text-cream/40 truncate">{seller?.email}</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-amber text-onyx'
                    : 'text-cream/70 hover:bg-cream/10 hover:text-cream'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-cream/10">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-cream/60 hover:bg-cream/10 hover:text-cream transition-colors w-full"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white border-b border-sand-dark px-4 sm:px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-onyx/60 hover:text-onyx"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="text-sm text-onyx/50">Portal do Vendedor</p>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
