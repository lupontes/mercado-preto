import type { Metadata } from 'next'
import { Inter, Montserrat } from 'next/font/google'
import '@/styles/globals.css'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { CartHydration } from '@/components/layout/CartHydration'
import { ChatwootWidget } from '@/components/layout/ChatwootWidget'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat' })

export const metadata: Metadata = {
  title: {
    default: 'Mercado Preto — Poder na raiz, riqueza na nossa mão',
    template: '%s | Mercado Preto',
  },
  description:
    'Marketplace de afroemprendedores — artesanato, serviços e cultura afro-brasileira. Uma iniciativa da Mulheres de Axé do Brasil.',
  keywords: ['afroemprendedores', 'artesanato', 'cultura afro-brasileira', 'marketplace', 'MAB'],
  openGraph: {
    siteName: 'Mercado Preto',
    locale: 'pt_BR',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${montserrat.variable}`}>
      <body>
        <CartHydration />
        <ChatwootWidget />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  )
}
