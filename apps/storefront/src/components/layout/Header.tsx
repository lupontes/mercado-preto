import Link from 'next/link'
import { Search, Menu } from 'lucide-react'
import { CartCount } from '@/components/cart/CartCount'

export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-onyx text-cream shadow-lg">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="font-display text-xl font-black tracking-tight">
              <span className="text-amber">Mercado</span>
              <span className="text-cream"> Preto</span>
            </span>
          </Link>

          {/* Search */}
          <div className="flex flex-1 max-w-xl">
            <div className="relative w-full">
              <input
                type="search"
                placeholder="Buscar produtos, lojas, artesãos..."
                className="w-full rounded-lg bg-cream/10 px-4 py-2 pl-10 text-sm text-cream placeholder:text-cream/50 outline-none focus:ring-2 focus:ring-amber"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cream/50" />
            </div>
          </div>

          {/* Actions */}
          <nav className="flex items-center gap-4">
            <Link
              href="/lojas"
              className="hidden sm:block text-sm text-cream/80 hover:text-amber transition-colors"
            >
              Lojas
            </Link>
            <Link
              href="/categorias"
              className="hidden sm:block text-sm text-cream/80 hover:text-amber transition-colors"
            >
              Categorias
            </Link>
            <CartCount />
            <Link
              href="/entrar"
              className="hidden sm:block rounded-lg bg-amber px-4 py-1.5 text-sm font-semibold text-onyx hover:bg-amber-light transition-colors"
            >
              Entrar
            </Link>
            <button aria-label="Menu" className="sm:hidden">
              <Menu className="h-6 w-6 text-cream" />
            </button>
          </nav>
        </div>
      </div>
    </header>
  )
}
