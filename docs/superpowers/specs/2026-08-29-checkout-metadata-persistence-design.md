# Persistência de metadados do checkout — Design

**Status**: Aprovado pelo usuário, pronto para plano de implementação.

## Problem

Teste manual de 29/08 (reteste da Task 5 do split multi-vendedor, depois do fix de comissão) revelou um bug mais grave e mais antigo: o webhook de pagamento aprovado (`api/webhooks/mercadopago/route.ts`) recuperou `payment.metadata` vazio (`{}}`) da API do MercadoPago — comportamento já esperado e documentado no próprio código (comentário na linha 123-124: "MP does not propagate preference.metadata to the payment object") — e então tentou o fallback já existente: buscar a preferência original por `external_reference` via `Preference().search()`, pra recuperar os metadados (itens, `seller_groups`, endereço) gravados na criação da preferência.

Essa busca **retornou zero resultados**, mesmo a preferência existindo de verdade (confirmado via `GET /checkout/preferences/search?external_reference=...` direto na API do MP, e via `GET /v1/payments/{id}` mostrando o `external_reference` batendo certinho entre pagamento e preferência). Investigação (`GET /checkout/preferences/search?sort=date_created&criteria=desc`, sem filtro) mostrou que a preferência mais recente indexada pela busca do MP era de **quatro horas antes** do teste — ou seja, a busca de preferências do MercadoPago tem um atraso de indexação de horas, não segundos.

**Consequência:** o webhook, sem conseguir recuperar os metadados, caiu no fallback de "1 grupo com os itens/seller_id do `meta` vazio" (`route.ts:146-155`), criando um pedido real (`order_01M17WX4MAZ0GKCYKQ6C4YWW61`, pago R$ 221,15 de verdade em sandbox) com **zero itens e nenhum `seller_id`** — um "pedido fantasma". Isso não é uma regressão da branch de split multi-vendedor: o mecanismo de fallback via busca de preferência já existe desde a implementação original do webhook (bem antes da Task 4) e nunca foi testado num checkout com timing realista (cliente paga minutos depois de montar o carrinho, não horas depois).

**Escopo do risco:** como um checkout real tipicamente completa entre a criação da preferência e o pagamento em minutos — não horas — esse fallback provavelmente falha silenciosamente na maioria dos checkouts reais, inclusive em produção, sempre que `payment.metadata` vem vazio (o que parece ser o comportamento padrão da API do MP, não uma exceção).

## Current State (lido do código, 2026-08-29)

- **Criação da preferência** (`api/store/checkout/preference/route.ts`): recebe itens/endereço/frete/documento do storefront, resolve vendedor por item, grava tudo em `metadata` da preferência MercadoPago (`seller_groups`, `items`, `address`, `shipping`, `buyer_document`, `total`) e retorna `preference_id` + `external_reference` pro frontend. **Nada disso é persistido no nosso banco** — o único lugar onde esses dados existem é dentro do objeto `metadata` da preferência, do lado do MercadoPago.
- **Webhook de pagamento aprovado** (`api/webhooks/mercadopago/route.ts:118-155`): ao receber a notificação, busca o pagamento via `paymentClient.get()`. Se `payment.metadata.items` vier vazio, tenta recuperar via `prefClient.search({ options: { external_reference } })` — que é exatamente a chamada que falhou no teste de hoje. Se a busca não encontrar nada (sem lançar exceção — só retorna `elements: []`), o código segue como se `meta` fosse o `payment.metadata` original (vazio), e monta um único grupo fallback com `items: meta?.items ?? []` (vazio) e `sellerId: meta?.seller_id` (undefined) — sem nenhum log de erro ou aviso indicando que a recuperação falhou.
- **Nenhum outro lugar do código guarda uma cópia local do que foi montado no checkout** antes do pagamento ser confirmado.

## Goal

O webhook de pagamento aprovado consegue recuperar os metadados do checkout (itens, `seller_groups`, endereço, frete, documento do comprador) **de forma confiável e imediata**, sem depender da disponibilidade ou latência de indexação de nenhuma API externa do MercadoPago.

## Non-Goals

- **Não migra o checkout pro fluxo nativo de Cart do Medusa** (`completeCartWorkflow`). O carrinho continua 100% client-side (`cart-store.ts`) e a criação de pedido continua via `orderService.createOrders()` direto — essa é uma melhoria arquitetural maior, fora do escopo desta correção urgente.
- **Não corrige o pedido fantasma já criado no teste de hoje** (`order_01M17WX4MAZ0GKCYKQ6C4YWW61`, ambiente de teste, dado descartável).
- **Não adiciona retry ou polling na busca de preferência do MercadoPago** — dado o atraso de indexação medido em horas, retry não resolveria; a fonte de verdade passa a ser nossa, não mais uma tentativa de contornar a API externa.
- **Não altera a lógica de resolução de vendedor, agrupamento por vendedor, rateio de frete, criação de N pedidos ou emissão de comissão/NF-e** — todos esses já funcionam corretamente (confirmado nos testes de hoje) uma vez que os metadados corretos chegam ao webhook. O problema é exclusivamente **como os metadados chegam** até ali.

## Design

### Novo módulo `checkout`

Segue o padrão já estabelecido pelos módulos `commission`, `fiscal`, `payout` e `seller` (cada um com `index.ts`, `models/`, `service.ts`, `migrations/`): um módulo novo e enxuto, cuja única responsabilidade é guardar um snapshot do checkout no momento da criação da preferência, indexado por `external_reference`.

**Model `checkout-snapshot`** (`src/modules/checkout/models/checkout-snapshot.ts`): um registro por preferência criada.

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string (PK, gerado) | padrão Medusa |
| `externalReference` | string, único, indexado | chave de busca do webhook — mesmo valor gravado como `external_reference` na preferência MP |
| `payload` | jsonb | `{ sellerGroups, items, address, shipping, buyerDocument, total }` — mesma forma que hoje vai pro `metadata` da preferência MP, sem transformação |
| `preferenceId` | string, opcional | preenchido depois que `preference.create()` retorna, para rastreabilidade (não é a chave de busca) |
| `created_at` / `updated_at` | timestamp | padrão Medusa |

Sem soft-delete, sem expiração automática — por decisão do usuário, vira trilha de auditoria permanente de todo checkout iniciado (pago ou não), útil para investigar disputas, chargebacks e casos como o de hoje. Índice único em `externalReference` garante a busca O(1) e previne duplicidade caso a rota de criação de preferência seja chamada duas vezes para o mesmo carrinho (não deveria acontecer hoje, mas o índice único é uma trava de sanidade barata).

**Service** (`src/modules/checkout/service.ts`): `MedusaService` padrão gerado a partir do model (mesmo padrão de `commission`/`fiscal`) — não precisa de lógica customizada além do CRUD gerado, já que é puramente um snapshot indexado por chave.

### `checkout/preference/route.ts` — grava o snapshot

Depois que `groupItemsBySeller` resolve `seller_groups` (lógica que já existe, inalterada) e **antes** de chamar `preference.create()`, a rota grava um `checkout-snapshot` com `externalReference` (o mesmo UUID já gerado na linha `const externalReference = crypto.randomUUID()`) e o `payload` completo. Se a gravação falhar (erro de banco), a rota responde `500` sem chamar o MercadoPago — melhor falhar cedo e o cliente tentar de novo do que criar uma preferência de pagamento cujo pedido nunca poderá ser reconstruído corretamente.

Depois que `preference.create()` retorna com sucesso, a rota atualiza o snapshot com o `preferenceId` retornado (campo auxiliar de rastreabilidade, não crítico — se essa segunda escrita falhar, loga um warning e responde a preferência normalmente pro frontend, já que o dado essencial — o `payload` por `externalReference` — já está salvo).

O `metadata` continua sendo gravado na preferência do MercadoPago exatamente como hoje (`seller_groups`, `items`, `address`, `shipping`, `buyer_document`, `total`) — não removemos essa via, ela continua sendo o **fast path**: se `payment.metadata` vier populado (o que a doc do MP sugere que pode acontecer em alguns casos), o webhook usa direto, sem nem consultar nosso banco.

### `webhooks/mercadopago/route.ts` — lê do nosso banco em vez de buscar no MP

A ordem de recuperação de metadados passa a ser:

1. `payment.metadata` (fast path, inalterado) — se `meta?.items?.length` for verdadeiro, usa direto, sem tocar no banco nem no MP.
2. **Novo**: se vazio, busca `checkoutSnapshotService.retrieveByExternalReference(payment.external_reference)` (ou equivalente `list` com filtro) no nosso módulo `checkout`. Essa é agora a fonte de verdade primária de fallback — sempre disponível, sem latência de indexação externa, desde o instante em que a preferência foi criada.
3. **Mantido como último recurso**: se por algum motivo o snapshot não existir no nosso banco (ex.: preferências criadas antes deste deploy, durante a janela de transição), tenta a busca por `external_reference` no MercadoPago como hoje — sabendo que pode falhar, mas sem custo adicional de mantê-la como rede de segurança.
4. Se as três fontes falharem, loga um **erro** (não mais silencioso) com o `external_reference` e **não cria o pedido** — melhor um webhook que falha de forma visível (HTTP 200 pro MP pra não gerar retry infinito, mas com log de erro claro e, futuramente, um alerta) do que um pedido fantasma cobrando o cliente sem entregar nada. Esse comportamento (não criar pedido sem itens) é a mudança de comportamento observável desta correção — hoje o código cria o pedido vazio silenciosamente; depois da correção, ele recusa e loga.

O restante do webhook (agrupamento por vendedor, criação de N pedidos, emissão de eventos `order.placed` e `mercadopago.order_approved`) não muda.

## Error Handling

- Escrita do snapshot falha na criação da preferência → `500` pro frontend, preferência MP não é criada, cliente pode tentar de novo. Evita o cenário onde a preferência existe no MP mas não tem snapshot nosso (o próprio problema que estamos corrigindo).
- Snapshot não encontrado nem via banco nem via busca MP no webhook → não cria pedido, loga erro com `external_reference` e `payment.id` pra investigação manual, responde `200` pro MercadoPago (evita retry automático infinito do MP pra um caso que retry não resolve).
- Preferência já processada (idempotência existente, `pendingGroups.length === 0`) → comportamento inalterado.

## Testing

- Unit tests do novo `checkout` module (`service.unit.spec.ts`, padrão dos outros módulos): grava e recupera snapshot por `externalReference`; índice único rejeita duplicata.
- Unit tests de `checkout/preference/route.ts`: grava snapshot com o payload esperado antes de chamar `preference.create()`; responde `500` sem chamar o MP se a gravação falhar.
- Unit tests de `webhooks/mercadopago/route.ts`: (a) usa `payment.metadata` quando presente, sem tocar no banco; (b) usa o snapshot do banco quando `payment.metadata` vem vazio; (c) cai no fallback de busca MP quando nem `payment.metadata` nem snapshot existem; (d) **não cria pedido** e loga erro quando as três fontes falham (teste novo — hoje esse caminho cria um pedido vazio, é o bug que estamos corrigindo).
- Verificação manual: reproduzir o teste de hoje (carrinho multi-vendedor, checkout completo em poucos minutos) no servidor de teste, e confirmar via banco que o pedido nasce com itens e `seller_id` corretos mesmo com `payment.metadata` vazio.
