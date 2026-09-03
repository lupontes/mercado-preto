# Reconciliação: split por vendedor + persistência de snapshot do checkout — Design

**Status**: Aprovado pelo usuário, pronto para plano de implementação.

## Problem

Duas branches irmãs, ambas derivadas do mesmo commit-base (`d437c4b`, pós-merge da PR #37), evoluíram em paralelo e agora divergem nos dois mesmos arquivos:

- `fix/multi-seller-cart-order-split` (deployada e em QA no servidor de teste): resolve o vendedor de cada item por `productId`, agrupa o carrinho em `seller_groups` e faz o webhook criar **N pedidos** (um por vendedor) a partir de um único pagamento.
- `fix/checkout-metadata-persistence` (code-complete, ainda não deployada): descobriu, durante o reteste manual da branch acima, que a busca de preferência do MercadoPago (usada pelo webhook pra recuperar os metadados do checkout quando `payment.metadata` vem vazio — comportamento padrão da API) tem atraso de indexação de **horas**, não segundos, causando pedidos fantasma (pagos, sem itens). Resolveu isso gravando um snapshot do checkout no banco próprio (`checkout` module) no momento da criação da preferência, e fazendo o webhook ler esse snapshot local primeiro, só caindo no fallback de busca no MP se o snapshot não existir ou a consulta falhar.

A branch de persistência foi implementada corretamente contra `develop` (que ainda não tem o split — usa `seller_id` simples, um único pedido). O revisor final dessa branch já sinalizou o risco: **quem mergear por último precisa reconciliar** `checkoutSnapshotPayload` pra carregar `seller_groups`, senão o snapshot recuperado não tem `seller_groups`, o webhook do split cai no fallback de 1 grupo com `sellerId: undefined`, e o pedido nasce com itens mas sem vendedor.

As duas mudanças são ortogonais — uma decide **o quê** vai no metadata (split por vendedor), a outra decide **como** esse metadata é lido/escrito (snapshot local em vez de depender só da API do MP) — e precisam conviver no mesmo código.

## Current State (lido do código, 2026-09-03)

- **`fix/multi-seller-cart-order-split`** (worktree principal, commit `418338b`):
  - `preference/route.ts`: schema com `productId` obrigatório por item, sem `.min(1)`; resolve vendedor via `query.graph`; agrupa com `groupItemsBySeller` (`utils/seller-order-groups.ts`); grava `metadata: { seller_groups, buyer_document, address, items (flat), shipping, total }` direto na preferência MP — sem persistência local.
  - `webhooks/mercadopago/route.ts`: recupera `meta` só via `payment.metadata` ou busca de preferência no MP (sem fallback local); deriva `sellerGroups` de `meta.seller_groups` com fallback pra 1 grupo; cria N pedidos com idempotência por `(external_reference, seller_id)`.
- **`fix/checkout-metadata-persistence`** (worktree `.worktrees/fix-checkout-metadata-persistence`, commit `061681a`, code-complete):
  - Módulo `checkout` novo (`CHECKOUT_MODULE`, `CheckoutModuleService.recordSnapshot/findByExternalReference/attachPreferenceId`, migration raw-SQL) — isolado, sem conflito com a outra branch.
  - `preference/route.ts`: schema sem `productId`, com `.min(1)` e `sellerId` opcional (nunca enviado pelo storefront — campo morto); grava `checkoutSnapshotPayload` no banco local **antes** de criar a preferência MP (bloqueante, 500 se falhar); usa o mesmo objeto como `metadata` da preferência; `attachPreferenceId` best-effort depois.
  - `webhooks/mercadopago/route.ts`: tenta `checkoutService.findByExternalReference` primeiro (guardado em try/catch — falha cai pro fallback, não aborta o webhook); só então tenta a busca legada no MP; refusa criar pedido (loga erro, responde 200) se `meta.items` continuar vazio depois das duas tentativas; cria **um único pedido** (ainda não conhece `seller_groups`).
  - Ambas as branches compartilham o mesmo commit-base; nenhum outro arquivo diverge entre elas.

## Goal

Uma única branch (`fix/multi-seller-cart-order-split`) com as duas capacidades combinadas: split por vendedor em N pedidos **e** recuperação confiável dos metadados via snapshot local, sem depender de latência/disponibilidade da API do MercadoPago.

## Non-Goals

- Não muda a lógica de resolução de vendedor, rateio de frete ou cálculo de subtotal por grupo — já corretas na branch de split, não tocadas aqui.
- Não muda o desenho do módulo `checkout` (model, migration, service) — entra como está, sem conflito.
- Não corrige achados Minor já deferidos em nenhuma das duas revisões finais (estilo de chamada, tipos `any`, etc.) — fora de escopo desta reconciliação.
- Não mexe na branch `fix/commission-mercadopago-order-approved-event` — arquivos completamente diferentes, ciclo de PR próprio e independente.

## Design

### Estratégia de git

`git merge fix/checkout-metadata-persistence` estando em `fix/multi-seller-cart-order-split`. Conflito esperado em exatamente 2 arquivos de produção (`preference/route.ts`, `webhooks/mercadopago/route.ts`) + seus `__tests__/*.unit.spec.ts`. O módulo `checkout/` inteiro, a migration e os docs da branch de persistência entram sem conflito. Após validar (testes verdes, revisão), apaga branch e worktree `fix/checkout-metadata-persistence` — trabalho preservado no commit de merge.

### Formato do snapshot (`checkoutSnapshotPayload`)

Usa o formato que a branch de split já grava hoje — é um superset do formato da branch de persistência:

```ts
{
  seller_groups: SellerGroup[],   // da branch de split — substitui o `seller_id` solto da persistência
  buyer_document: string,
  address: { first_name, last_name, email, phone, address_1, address_2, city, state, postal_code },
  items: Array<{ variant_id?, title, quantity, price }>,  // visão "carrinho inteiro", usada pela tela de confirmação
  shipping: { id, name, price },
  total: number,
}
```

O campo `sellerId` solto do schema Zod da persistência é removido (nunca foi enviado pelo storefront).

### `preference/route.ts` combinado

Ordem de operações:

1. Valida schema: `items` com `productId` obrigatório **e** `.min(1)` (as duas validações já existentes nas branches de origem, sem `sellerId` solto).
2. Resolve vendedor por `productId` via `query.graph`, agrupa com `groupItemsBySeller` → `400` se algum produto não tiver vendedor associado (comportamento já existente na branch de split).
3. Monta `checkoutSnapshotPayload` (seção anterior) com `seller_groups: grouped.groups`.
4. Grava o snapshot via `checkoutService.recordSnapshot(externalReference, checkoutSnapshotPayload)` **antes** de chamar o MP — bloqueante, `500` se falhar (comportamento da branch de persistência — é o que resolve a perda de metadata).
5. Cria a preferência MP com `metadata: checkoutSnapshotPayload` (mesmo objeto — fonte única, sem duplicar a montagem do metadata).
6. `attachPreferenceId` best-effort depois da criação (não bloqueia a resposta ao cliente; falha só gera warning de log).

### `webhooks/mercadopago/route.ts` combinado

1. Recuperação de `meta`: se `payment.metadata` vier vazio, tenta `checkoutService.findByExternalReference` — guardado em try/catch, falha aqui não aborta, cai pro fallback. Se o snapshot local não existir (ou a consulta falhar), cai no fallback legado de busca de preferência no MP.
2. Guarda de "nada recuperado": se `meta?.items` (a lista flat, visão carrinho-inteiro) continuar vazia depois das duas tentativas, loga erro e recusa — responde `200` sem criar pedido. Checagem no payload como um todo, não por grupo (um grupo só existe em `seller_groups` se `groupItemsBySeller` já garantiu que ele tem ≥1 item — a guarda aqui cobre o caso "não recuperamos metadado nenhum", não "um grupo específico ficou vazio").
3. Deriva `sellerGroups` de `meta.seller_groups`, com fallback pra 1 grupo único (`sellerId: meta?.seller_id`, itens de `meta.items`) se `seller_groups` não existir — compat com preferências criadas antes desta reconciliação.
4. Idempotência e criação de pedidos por grupo: checagem de pedido existente por `(mercadopago_external_reference, seller_id)`, `createOrders` só dos grupos pendentes, emite `order.placed` + `mercadopago.order_approved` só dos pedidos recém-criados. Lógica já existente na branch de split, sem mudanças.

## Testing

- Mantém os testes já verdes das duas branches de origem que não se sobrepõem (idempotência por grupo, erro de vendedor não resolvido, rateio de frete, `items.min(1)`, recuperação via snapshot local, fallback legado, guarda de payload vazio).
- Testes novos pro comportamento combinado:
  - Snapshot local recuperado com `seller_groups` preenchido → cria N pedidos (um por grupo), sem chamar a busca legada no MP.
  - Snapshot local ausente/falha → cai no fallback de busca no MP → `seller_groups` recuperado do metadata legado da preferência → cria N pedidos.
  - Snapshot local ausente **e** busca legada sem resultado → nenhum pedido criado, erro logado (guarda de payload vazio).
- Meta: todas as suítes de `packages/medusa-backend/apps/backend` verdes (backend `test:unit`) e suíte do storefront (`apps/storefront`, `npm test`) sem regressão, rodadas ao final do merge.
