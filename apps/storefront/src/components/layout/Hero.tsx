import Link from 'next/link'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-onyx text-cream">
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 50%, #D4A017 0%, transparent 50%),
                            radial-gradient(circle at 80% 20%, #B84B2D 0%, transparent 40%),
                            radial-gradient(circle at 60% 80%, #2D6A35 0%, transparent 40%)`,
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
        <div className="max-w-2xl">
          <p className="text-amber font-semibold text-sm uppercase tracking-widest mb-4">
            Uma iniciativa da Mulheres de Axé do Brasil
          </p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-black leading-tight text-balance mb-6">
            Poder na raiz,{' '}
            <span className="text-amber">riqueza na nossa mão</span>
          </h1>
          <p className="text-cream/70 text-lg sm:text-xl mb-8 text-balance">
            Descubra produtos únicos de afroemprendedores — artesanato, moda, gastronomia e serviços
            enraizados na cultura afro-brasileira.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/produtos"
              className="rounded-lg bg-amber px-6 py-3 font-semibold text-onyx hover:bg-amber-light transition-colors"
            >
              Explorar produtos
            </Link>
            <Link
              href="/sobre"
              className="rounded-lg border border-cream/30 px-6 py-3 font-semibold text-cream hover:border-cream/60 transition-colors"
            >
              Sobre o projeto
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
