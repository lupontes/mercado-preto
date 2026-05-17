import Link from 'next/link'

export function Footer() {
  return (
    <footer className="bg-onyx text-cream/70">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <p className="font-display text-lg font-black text-cream mb-2">
              <span className="text-amber">Mercado</span> Preto
            </p>
            <p className="text-sm">
              Uma iniciativa da{' '}
              <a
                href="https://mulheresdeaxedobrasil.com.br"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber hover:underline"
              >
                Mulheres de Axé do Brasil
              </a>
              , com apoio da Fundação Banco do Brasil.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-cream mb-3">Marketplace</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/produtos" className="hover:text-amber transition-colors">Produtos</Link></li>
              <li><Link href="/lojas" className="hover:text-amber transition-colors">Lojas</Link></li>
              <li><Link href="/categorias" className="hover:text-amber transition-colors">Categorias</Link></li>
              <li><Link href="/rastrear" className="hover:text-amber transition-colors">Rastrear pedido</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-cream mb-3">Vendedores</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/vender" className="hover:text-amber transition-colors">Quero vender</Link></li>
              <li><Link href="/painel" className="hover:text-amber transition-colors">Painel do vendedor</Link></li>
              <li><Link href="/ajuda/vendedores" className="hover:text-amber transition-colors">Suporte</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-cream mb-3">Institucional</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/sobre" className="hover:text-amber transition-colors">Sobre o projeto</Link></li>
              <li><Link href="/privacidade" className="hover:text-amber transition-colors">Privacidade (LGPD)</Link></li>
              <li><Link href="/termos" className="hover:text-amber transition-colors">Termos de uso</Link></li>
              <li>
                <a
                  href="https://instagram.com/mulheres.axe.brasil"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-amber transition-colors"
                >
                  @mulheres.axe.brasil
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-cream/10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs">
          <p>© {new Date().getFullYear()} Mercado Preto — Mulheres de Axé do Brasil</p>
          <p>Financiado pela Fundação Banco do Brasil · Edital Empoderamento Mulheres Negras</p>
        </div>
      </div>
    </footer>
  )
}
