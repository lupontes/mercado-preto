# Design: Tela de Repasses / Payouts (Admin)

**Data:** 2026-07-11
**Autor:** Luciano Pontes (via Claude Code)
**Status:** Aprovado, aguardando plano de implementação

## Contexto

Este é o terceiro dos quatro subprojetos de UI de admin planejados (Vendedores e Comissões já estão completos e em produção). O backend já tem rotas parciais para repasses (`GET`/`POST /admin/payouts`, `POST /admin/payouts/:id/process`), mas nenhuma tela no admin. Diferente de Comissões (100% relatório), Payouts é o subsistema onde o admin efetivamente age: cria um repasse para um vendedor, faz a transferência bancária/PIX manualmente (fora do sistema — não há integração de transferência automática), e marca como processado.

### Descobertas durante o brainstorm

- O modelo `Payout` tem um enum de status com 4 valores (`pending`, `processing`, `completed`, `failed`), mas só `pending`→`completed` é usado de fato — `processing` e `failed` nunca são setados em código algum. Mesmo padrão de "enum morto" já visto em `Commission.status` antes da feature de Comissões.
- `GET /admin/payouts` tem o mesmo bug de escopo já corrigido em Comissões: `total`/`count` são calculados sobre a página paginada, não o conjunto total filtrado.
- Não existe rota de detalhe (`GET /admin/payouts/:id`) — só lista, criação e processamento.
- `POST /admin/payouts` hoje exige que o admin digite manualmente o valor (`amount`), sem cálculo automático a partir das comissões pendentes.
- `Seller` já tem campos bancários/PIX (`bankName`, `bankAgency`, `bankAccount`, `bankAccountType`, `pixKey`, `pixKeyType`) que hoje não aparecem em nenhuma rota de Payouts, mas são necessários para o admin efetuar a transferência.
- A spec de Comissões documentou como limitação aceita que uma `Commission` criada depois que o `Payout` do período já existe nunca é vinculada nem marcada como paga, mapeando duas mitigações para quando chegasse a vez de Payouts. Esta spec implementa as duas.

## Decisões

1. **Valor do repasse calculado automaticamente**, não editável pelo admin — soma das comissões pendentes/não vinculadas do vendedor no período escolhido. Elimina o risco de digitação manual divergente do que é realmente devido.
2. **Estrutura lista + página de detalhe** (padrão de Vendedores), não relatório único (padrão de Comissões) — Payouts tem ações reais (processar, cancelar) e precisa expor dados bancários/PIX do vendedor no detalhe.
3. **Janela de maturação de 5 dias**: bloqueia a criação de um `Payout` para um período cujo `periodEnd` seja mais recente que "hoje menos 5 dias" — dá tempo para pagamentos atrasados (boleto, PIX em análise, antifraude) confirmarem antes do período ser fechado. Não elimina o risco por completo, mas reduz bastante a probabilidade.
4. **Vínculo bidirecional**: ao criar uma `Commission` (subscriber `commission-on-payment.ts`), verifica se já existe um `Payout` **pendente** do mesmo vendedor cujo período cobre a data da comissão. Se existir, vincula a comissão a esse payout e **recalcula o `amount`** somando o valor dela (seguro, pois nenhuma transferência foi feita ainda). Se só existir um payout **já processado** cobrindo o período, não vincula — a comissão fica órfã do mesmo jeito que hoje, mitigada principalmente pela janela de maturação (decisão 3). Vincular a um payout já processado exigiria uma transferência bancária complementar fora do sistema, sem rastreamento — rejeitado.
5. **Payout de valor calculado R$ 0 → criação bloqueada.** Não faz sentido criar um repasse sem nenhuma comissão pendente no período; a tela mostra o valor calculado antes de confirmar.
6. **Filtro padrão da lista: "Pendentes"** — como Vendedores, a tela abre como fila de ação (o que precisa de processamento), não como relatório histórico.
7. **Cancelamento de payout pendente**: novo endpoint `POST /admin/payouts/:id/cancel`. Novo status `"cancelled"` no enum, distinto semanticamente de `"failed"` (cancelado = admin decidiu não prosseguir, nenhuma transferência foi tentada; failed = uma transferência foi tentada e não passou — fora de escopo esta spec, ver "Fora de escopo"). Cancelar solta as comissões vinculadas de volta para `payoutId: null`, livres para um payout futuro.
8. **Período sugerido automaticamente, editável**: ao escolher o vendedor no formulário de criação, o período é pré-preenchido como "desde o fim do último payout processado deste vendedor" (ou "desde a comissão pendente mais antiga", se for o primeiro payout do vendedor) até "hoje menos a janela de maturação" — evita períodos sobrepostos ou com lacunas por omissão, mas o admin pode ajustar as datas manualmente antes de confirmar.

## Arquitetura

### Modelo `Payout`

`status: model.enum(["pending", "processing", "completed", "failed", "cancelled"])` — adiciona `"cancelled"`. Nova migração em `src/modules/payout/migrations/`, seguindo a convenção `MigrationYYYYMMDDHHMMSS.ts` e o estilo SQL idempotente já usado (`alter table ... add column if not exists ...` / recriação do check constraint do enum).

### `CommissionModuleService` (`src/modules/commission/service.ts`)

- **Refatoração interna**: extrai o filtro já usado em `linkPendingToPayout` (comissões `pending`, `payoutId: null`, `created_at` dentro do período) para um método privado reaproveitado por `linkPendingToPayout`, pelo endpoint de preview (abaixo) e pelo vínculo bidirecional no subscriber.
- **Novo método:** `unlinkByPayout(payoutId: string): Promise<void>` — solta todas as comissões vinculadas àquele payout (`payoutId: null`). Usado no cancelamento.

### `PayoutModuleService` (`src/modules/payout/service.ts`)

- **Novo método:** `cancelPayout(id: string): Promise<Payout>` — seta `status: "cancelled"`. A validação de que o status atual é `"pending"` fica na rota, não no service.
- **Novo método:** `incrementAmount(id: string, delta: number): Promise<Payout>` — soma `delta` ao `amount` atual. Usado pelo vínculo bidirecional.

### Rotas — `src/api/admin/payouts/`

**`GET /admin/payouts` (lista) — corrigida:**
- `total`/`count` calculados sobre o conjunto completo filtrado (mesma correção aplicada em Comissões), não a página.
- Enriquecida com `sellerName` por payout (mesmo padrão de `GET /admin/commissions`).

**`GET /admin/payouts/preview` (novo):**
- Query params: `seller_id` (obrigatório), `period_start`/`period_end` (opcionais).
- Se `period_start`/`period_end` omitidos: calcula e retorna o período sugerido (ver decisão 8) junto com o valor calculado para esse período sugerido.
- Se informados: recalcula o valor para o período explícito (ignora a sugestão).
- Resposta: `{ periodStart: string, periodEnd: string, amount: number, commissionCount: number }`.
- Usado pelo formulário de criação para popular o período sugerido e recalcular o valor ao vivo a cada edição — nunca usado para decidir o valor final gravado (isso é recalculado de forma autoritativa no `POST`).

**`POST /admin/payouts` (criação) — reescrita:**
- Schema: remove `amount` do body (não é mais aceito do cliente). Mantém `sellerId`, `periodStart`, `periodEnd`, `notes?`.
- Validação da janela de maturação: se `periodEnd` for mais recente que `hoje - 5 dias`, retorna 400.
- Calcula o valor (mesma lógica do preview); se `0`, retorna 400.
- Cria o payout com o valor calculado, depois chama `linkPendingToPayout(sellerId, periodStart, periodEnd, payout.id)` como já acontece hoje.

**`GET /admin/payouts/:id` (detalhe, novo):**
- Retorna o payout + vendedor enriquecido (nome + campos bancários/PIX) + lista de comissões vinculadas (`commissionService.listCommissions({ payoutId: id })`).

**`POST /admin/payouts/:id/cancel` (novo):**
- 404 se o payout não existir; 409 se `status !== "pending"`.
- Chama `commissionService.unlinkByPayout(id)`, depois `payoutService.cancelPayout(id)`.

**`POST /admin/payouts/:id/process` — sem mudanças** (já chama `markAsProcessed` + `markPaidByPayout`, feito na feature de Comissões).

### Vínculo bidirecional — `src/subscribers/commission-on-payment.ts`

Depois de `commissionService.recordAndCreate(...)` (linha ~35-40 atual), resolve `PAYOUT_MODULE` e busca payouts `"pending"` do mesmo `sellerId` cujo período (`periodStart`/`periodEnd`) cobre `commission.created_at`. Se encontrar mais de um (caso raro de períodos sobrepostos), escolhe o mais antigo por `created_at` — comportamento determinístico documentado, não tratado como erro. Se encontrar, vincula a comissão (seta `payoutId`) e chama `incrementAmount` no payout com o `sellerPayout` da comissão. Se não encontrar nenhum pendente (ou só um já `completed`), não faz nada.

### Frontend

**Hooks (`src/admin/hooks/payouts.ts`, novo):** `usePayouts(filters)`, `usePayout(id)`, `usePayoutPreview(sellerId, periodStart?, periodEnd?)`, `useCreatePayout()`, `useProcessPayout()`, `useCancelPayout()` — mesmo padrão de `sdk.client.fetch` + `invalidateQueries` já usado em Vendedores/Comissões.

**Lista (`/app/payouts`, `src/admin/routes/payouts/page.tsx`, novo):**
- Filtros: vendedor + status (padrão `"Pendentes"`), cards de totais, tabela paginada (Vendedor, Valor, Período, Status), linha clicável → `/app/payouts/:id`.
- Botão "+ Novo repasse" abre um `FocusModal` (`@medusajs/ui`) com o formulário de criação — não é uma rota própria, é um fluxo transitório.

**Modal de criação:**
1. Admin seleciona o vendedor → dispara `usePayoutPreview(sellerId)` sem período → preenche período sugerido (editável) e valor calculado.
2. Edição manual do período → dispara novo preview, recalcula o valor ao vivo.
3. Valor calculado `R$ 0` → botão "Criar" desabilitado, com mensagem explicando por quê.
4. Confirmar → `useCreatePayout()`. O valor mostrado no modal é só preview; o servidor recalcula de forma autoritativa no `POST`.

**Detalhe (`/app/payouts/:id`, `src/admin/routes/payouts/[id]/page.tsx`, novo):**
- Dados do payout (valor, período, status, notas) + dados bancários/PIX do vendedor + tabela de comissões vinculadas.
- Botão "Processar" (se `pending`) → dialog de confirmação mostrando os dados bancários/PIX e o valor, pedindo confirmação explícita antes de chamar `useProcessPayout()` — mesmo padrão do dialog de "Rejeitar" em Vendedores.
- Botão "Cancelar" (se `pending`) → dialog de confirmação (ação libera as comissões vinculadas) antes de `useCancelPayout()`.
- Sem botões de ação se `completed`/`cancelled` — somente visualização.

## Testes

**Backend (Jest):**
- `src/modules/payout/__tests__/service.unit.spec.ts` (novo) — `cancelPayout`, `incrementAmount`.
- `src/modules/commission/__tests__/service.unit.spec.ts` (existente, estende) — `unlinkByPayout`.
- `src/api/admin/payouts/__tests__/route.unit.spec.ts` (existente, reescreve) — schema sem `amount`, janela de maturação, bloqueio de valor zero, enriquecimento com `sellerName`, total/count reais.
- `src/api/admin/payouts/preview/__tests__/route.unit.spec.ts` (novo) — sugestão de período, cálculo de valor com e sem período explícito.
- `src/api/admin/payouts/[id]/__tests__/route.unit.spec.ts` (novo) — detalhe com dados bancários + comissões vinculadas.
- `src/api/admin/payouts/[id]/cancel/__tests__/route.unit.spec.ts` (novo) — 404/409/sucesso + desvínculo.
- `src/subscribers/__tests__/commission-on-payment.unit.spec.ts` (novo — primeiro teste deste subscriber) — encontra payout pendente cobrindo o período → vincula e soma; só encontra `completed` → não faz nada; nenhum payout → não faz nada; múltiplos pendentes sobrepostos → escolhe o mais antigo.

**Frontend (Vitest):** mesmo padrão de Vendedores/Comissões (`.test.tsx`, mock de `sdk.client.fetch`).
- `src/admin/hooks/__tests__/payouts.test.tsx` (novo).
- `src/admin/routes/payouts/__tests__/page.test.tsx` (novo) — filtros, totais, paginação, modal de criação (preview ao vivo, bloqueio de valor zero).
- `src/admin/routes/payouts/[id]/__tests__/page.test.tsx` (novo) — dados bancários, comissões vinculadas, dialogs de processar/cancelar.

## Fora de escopo (explícito)

- Enum `"processing"` continua sem uso — não faz parte desta spec.
- Fluxo de marcar um payout como `"failed"` — não há integração bancária automática que dispararia isso; o enum existe sem UI/gatilho.
- Notificação automática ao vendedor quando um repasse é processado — feature separada.
- Editar um payout já criado além de processar/cancelar.
- Número de dias da janela de maturação configurável pelo admin — fixo em 5 por ora (constante no código), melhoria futura se necessário.
