import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Sobre o projeto',
  description:
    'O Mercado Preto é uma iniciativa da Mulheres de Axé do Brasil para viabilizar o acesso digital de afroemprendedores.',
}

export default function SobrePage() {
  return (
    <div className="bg-cream min-h-screen">
      <div className="bg-onyx text-cream py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <p className="text-amber font-semibold text-sm uppercase tracking-widest mb-4">
            Nossa história
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-black leading-tight">
            Sobre o Mercado Preto
          </h1>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 space-y-12">
        <section>
          <h2 className="font-display text-2xl font-black text-onyx mb-4">Quem somos</h2>
          <p className="text-onyx/70 leading-relaxed">
            O <strong>Mercado Preto</strong> é uma iniciativa da{' '}
            <strong>Mulheres de Axé do Brasil (MAB)</strong>, organização sediada em Cachoeira/BA
            que atua no empoderamento de mulheres negras e afroemprendedores do Recôncavo Baiano e
            de todo o Brasil.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-black text-onyx mb-4">Nossa missão</h2>
          <p className="text-onyx/70 leading-relaxed">
            Viabilizamos o acesso digital de artesãos, costureiras, chefs, terapeutas e outros
            profissionais afro-brasileiros que produzem com excelência mas ainda não têm presença no
            comércio eletrônico. Cada compra aqui é um ato de valorização da cultura e da economia
            negra.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-black text-onyx mb-4">Financiamento</h2>
          <p className="text-onyx/70 leading-relaxed">
            Este projeto foi viabilizado pela <strong>Fundação Banco do Brasil</strong> por meio do
            edital <em>Empoderamento Mulheres Negras</em>, que apoia iniciativas de geração de renda
            e inclusão digital para populações historicamente marginalizadas.
          </p>
        </section>

        <div className="rounded-2xl bg-amber/10 border border-amber/30 p-8 text-center">
          <p className="font-display text-xl font-black text-onyx mb-2">
            "Poder na raiz, riqueza na nossa mão"
          </p>
          <p className="text-onyx/60 text-sm">Tagline do Mercado Preto</p>
          <Link
            href="/lojas"
            className="mt-6 inline-block rounded-lg bg-amber px-6 py-3 font-semibold text-onyx hover:bg-amber-dark transition-colors"
          >
            Conhecer os vendedores
          </Link>
        </div>
      </div>
    </div>
  )
}
