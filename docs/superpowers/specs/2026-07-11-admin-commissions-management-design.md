# Design: Tela de Comissões (Admin)

**Data:** 2026-07-11
**Autor:** Luciano Pontes (via Claude Code)
**Status:** Aprovado, aguardando plano de implementação

## Contexto

Este é o segundo dos quatro subprojetos de UI de admin planejados (o primeiro, Vendedores, já está completo e em produção). O backend já tem uma rota de leitura para comissões (`GET /admin/commissions`), mas nenhuma tela no admin. As comissões são criadas automaticamente por um subscriber (`commission-on-payment.ts`, escuta `order.payment_captured`, idempotente) — não há criação/edição manual, então esta tela é **100% relatório**, sem ações do admin sobre uma comissão individual.

### Descoberta durante o brainstorm: `Commission.status` é código morto

O modelo `Commission` tem um campo `status: "pending" | "paid"` e o service tem um método `markAsPaid(id)` — mas **nenhuma rota da API chama esse método**. Não existe, além disso, nenhum vínculo entre `Commission` e `Payout` (o registro que representa um pagamento real ao vendedor, criado manualmente pelo admin via `POST /admin/payouts`). Resultado: mesmo depois de um `Payout` ser criado e processado para um vendedor, as `Commission`s daquele período continuam `"pending"` para sempre — o campo nunca reflete a realidade.

## Decisões

1. **Escopo da tela:** somente leitura — lista + totais + filtros. Nenhuma ação de "marcar como paga" nesta tela.
2. **Resolver o vínculo Commission↔Payout agora, na camada de API/dados** — sem construir nenhuma tela de Payout (esse é o próximo subprojeto). Ver "Arquitetura" abaixo.
3. **Momento da marcação como paga:** só quando o `Payout` é efetivamente processado (`status` vira `completed`), não quando é criado (ainda `pending`/pode falhar).
4. **Nome do vendedor:** a resposta de `GET /admin/commissions` é enriquecida no backend com o nome do vendedor (não faz sentido mostrar um ID cru na tela).
5. **Filtro padrão:** "Todos" (sem pré-seleção de status) — diferente de Vendedores, que abre em "Pendentes" como fila de ação. Comissões não tem fila de ação, é puramente informativo.
6. **Filtro de período (data):** fora de escopo por agora — documentado como melhoria futura, não esquecido.
7. **Paginação:** implementada de verdade nesta tela (a API já suporta `limit`/`offset`), usando `Table.Pagination` do `@medusajs/ui`. **Também será retrofitada na tela de Vendedores** como um ajuste pequeno e separado depois desta spec, reaproveitando o mesmo padrão de componente construído aqui.

## Arquitetura

### Vínculo Commission ↔ Payout

**Migração:** novo campo `payoutId: model.text().nullable()` no model `Commission` (`src/modules/commission/models/commission.ts`), com a migração correspondente em `src/modules/commission/migrations/` seguindo a convenção de nome `MigrationYYYYMMDDHHMMSS.ts` já usada nas duas migrações existentes do módulo.

**Dois métodos novos em `CommissionModuleService`** (`src/modules/commission/service.ts`):

```ts
async linkPendingToPayout(
  sellerId: string,
  periodStart: Date,
  periodEnd: Date,
  payoutId: string
): Promise<void> {
  const pending = await this.listCommissions({ sellerId, status: "pending" })
  const inPeriod = pending.filter((c: any) => {
    const created = new Date(c.created_at)
    return created >= periodStart && created <= periodEnd
  })
  for (const commission of inPeriod) {
    await this.updateCommissions({
      selector: { id: commission.id },
      data: { payoutId },
    })
  }
}

async markPaidByPayout(payoutId: string): Promise<void> {
  const linked = await this.listCommissions({ payoutId })
  for (const commission of linked) {
    await this.updateCommissions({
      selector: { id: commission.id },
      data: { status: "paid" as const, paidAt: new Date() },
    })
  }
}
```

O filtro por período é feito em memória (`Array.filter` sobre `created_at`), seguindo o mesmo padrão já usado em `src/api/admin/reports/route.ts` para o mesmo tipo de filtro — não uma query com operadores de data no ORM.

**Duas rotas existentes do módulo Payout são modificadas** para chamar esses métodos (resolvendo `COMMISSION_MODULE` a partir de uma rota de outro módulo — padrão já usado em `src/api/admin/reports/route.ts`, que resolve três módulos na mesma rota):

- `POST /admin/payouts` (`src/api/admin/payouts/route.ts`): depois de criar o `Payout`, chama `commissionService.linkPendingToPayout(sellerId, periodStart, periodEnd, payout.id)`.
- `POST /admin/payouts/:id/process` (`src/api/admin/payouts/[id]/process/route.ts`): depois de `markAsProcessed`, chama `commissionService.markPaidByPayout(payout.id)`.

### Backend — `GET /admin/commissions`

A rota existente (`src/api/admin/commissions/route.ts`) ganha duas mudanças:
1. **Enriquecimento com nome do vendedor:** depois de buscar as comissões, coleta os `sellerId`s únicos da página atual, busca os vendedores correspondentes via `SellerModuleService.listSellers({ id: [...] })`, e anexa `sellerName` em cada item retornado.
2. **Contrato de paginação:** a resposta já tem `count`, mas hoje `count` é `commissions.length` (o tamanho da página atual, não o total real) — vira uma contagem total real via uma segunda chamada sem `take`/`skip`, mesmo padrão já usado em `GET /admin/sellers`.

### Frontend (`/app/commissions`)

Nova rota `src/admin/routes/commissions/page.tsx`, registrada via `defineRouteConfig` com label "Comissões" no menu.

- **Filtros:** select de vendedor (busca a lista de vendedores via `useAdminSellers` já existente, de Vendedores) + select de status (`Todos` por padrão, `Pendente`, `Pago`).
- **Cards de totais:** GMV bruto, comissão retida, repasse total aos vendedores — usando o `totals` que a API já retorna, recalculado a cada mudança de filtro.
- **Tabela:** Pedido, Vendedor, Valor bruto, Comissão, Repasse, Status (badge), Data.
- **Paginação:** `Table.Pagination` do `@medusajs/ui`, controlando `limit`/`offset` no hook de dados.

Hooks novos em `src/admin/hooks/commissions.ts`: `useAdminCommissions(filters)`, reaproveitando o `sdk` client já criado em `src/admin/lib/sdk.ts` (Vendedores).

## Testes

**Backend:**
- `src/modules/commission/__tests__/service.unit.spec.ts` (novo arquivo) — testa `linkPendingToPayout` e `markPaidByPayout` diretamente, usando o padrão já estabelecido em `src/modules/seller/__tests__/service.unit.spec.ts` (mock de `MedusaService` via `jest.mock("@medusajs/framework/utils", ...)`, preservando o resto do módulo real).
- `src/api/admin/payouts/__tests__/route.unit.spec.ts` (novo) — verifica que `POST /admin/payouts` chama `linkPendingToPayout` com os argumentos certos.
- `src/api/admin/payouts/[id]/process/__tests__/route.unit.spec.ts` (novo) — verifica que `POST /admin/payouts/:id/process` chama `markPaidByPayout` com o `payoutId` certo.
- `src/api/admin/commissions/__tests__/route.unit.spec.ts` (novo) — verifica enriquecimento com nome do vendedor e paginação.

**Frontend:** mesmo padrão de Vendedores (Vitest, `.test.tsx`, mock do `sdk.client.fetch`) — testes de componente para a lista (filtros, totais, paginação, estado vazio).

## Fora de escopo (explícito)

- Filtro de período (data início/fim) — documentado, não esquecido.
- Qualquer ação de admin sobre uma comissão individual (a tela é só leitura).
- Tela de Payouts em si (próximo subprojeto) — só as duas rotas de API do módulo Payout são tocadas, e só para adicionar a chamada de vínculo/marcação.
- Retrofit de paginação em Vendedores — feito como ajuste separado após esta spec, reaproveitando o componente construído aqui.

## Limitação conhecida: vínculo tardio (aceita por ora)

O vínculo `Commission`↔`Payout` (`linkPendingToPayout`) só acontece em um momento: quando o admin cria um `Payout` (`POST /admin/payouts`), buscando as comissões `pending` já existentes naquele instante para o vendedor/período. É uma via única, não bidirecional.

**Cenário de risco:** uma `Commission` é criada pelo subscriber `commission-on-payment.ts` (que escuta `order.payment_captured`) *depois* que o admin já fechou o `Payout` daquele período — por exemplo, um pagamento via boleto/PIX/análise antifraude que demora alguns dias para confirmar. Essa comissão nunca é vinculada a nenhum payout e fica `"pending"` permanentemente, reproduzindo em miniatura o mesmo problema que esta spec resolve para o caso comum.

**Por que foi aceito por ora:** na prática, o admin tende a fechar payouts de períodos já encerrados há alguns dias, o que reduz bastante a chance de um pagamento ainda estar em trânsito. Resolver de verdade exige mudanças que pertencem ao subsistema de Payouts (ainda não iniciado), então o risco residual foi documentado aqui em vez de expandir o escopo desta spec.

**Mitigações mapeadas para o ciclo de Payouts (brainstorm → spec → plano próprios, ainda não iniciado):**
1. **Janela de maturação** (prática comum de mercado — ex: Stripe Connect usa `delay_days`): impedir a criação de um `Payout` para um período que ainda não "esfriou" um número mínimo de dias após seu término, dando tempo para pagamentos atrasados confirmarem antes do fechamento. Reduz bastante o risco, mas não o elimina por completo — mudança pequena, validação nova em `POST /admin/payouts`.
2. **Vínculo bidirecional** (correção estrutural completa): ao criar uma `Commission`, verificar se já existe um `Payout` cobrindo aquele vendedor/período e vinculá-la automaticamente. Fecha a lacuna por completo, mas exige tocar o subscriber `commission-on-payment.ts` — mudança de escopo maior.

Ambos os mecanismos devem ser documentados no manual do administrador quando ele for atualizado, para que quem opera o sistema entenda o comportamento de vínculo de comissões e payouts.
