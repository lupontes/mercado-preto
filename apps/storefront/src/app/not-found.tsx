import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="bg-cream min-h-[60vh] flex items-center justify-center">
      <div className="text-center px-4">
        <p className="font-display text-8xl font-black text-amber/30">404</p>
        <h1 className="font-display text-2xl font-black text-onyx mt-4">Página não encontrada</h1>
        <p className="text-onyx/60 mt-2">O que você procura pode ter mudado de lugar.</p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-lg bg-amber px-6 py-3 font-semibold text-onyx hover:bg-amber-dark transition-colors"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  )
}
