export function MissionBanner() {
  const pillars = [
    { icon: '🌿', title: 'Raízes Vivas', desc: 'Cultura afro-brasileira em cada produto' },
    { icon: '✊', title: 'Empoderamento', desc: 'Renda direta para afroemprendedores' },
    { icon: '🤝', title: 'Comunidade', desc: 'Rede de apoio e solidariedade' },
    { icon: '🛡️', title: 'Segurança', desc: 'Pagamento protegido e garantido' },
  ]

  return (
    <section className="bg-sand py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {pillars.map((p) => (
            <div key={p.title} className="text-center">
              <div className="text-3xl mb-2">{p.icon}</div>
              <h3 className="font-display font-bold text-onyx mb-1">{p.title}</h3>
              <p className="text-sm text-onyx/60">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
