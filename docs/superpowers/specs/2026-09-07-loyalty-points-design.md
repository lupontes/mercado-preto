# Programa de Fidelidade (Pontos) — Design

**Status**: Aprovado pelo usuário — **registrado apenas, sem implementação ainda**. Retomar via `superpowers:writing-plans` quando for priorizado.

## Problem

O Mercado Preto não tem nenhum mecanismo de recompensa por compra recorrente. É o último dos três itens identificados como "sem bloqueio externo" no backlog do projeto (`docs/RELATORIO_STACK_E_PROGRESSO.md`, Fase 7) — os outros dois (centro de mensagens comprador↔vendedor e sistema de avaliação de produtos) já foram implementados.

## Current State (lido do código, 2026-09-07)

- **Não existe conta de comprador** — mesma restrição já documentada nos designs de mensageria e avaliação. Checkout é 100% convidado.
- **O checkout já coleta e valida CPF/CNPJ do comprador**, hoje usado só para a NF-e: `api/store/checkout/preference/route.ts:38` (`document: z.string().refine((v) => validateDocument(v).valid, ...)`), normalizado em `buyerDocument` (linha 55, `validateDocument(document).digits`) e gravado em `checkoutSnapshotPayload.buyer_document` (linha 80) — que o módulo `checkout` (`CHECKOUT_MODULE`) persiste como snapshot da preferência, e o webhook do MercadoPago recupera de volta em `buyer_document: meta?.buyer_document` (`api/webhooks/mercadopago/route.ts:234`) pra usar na NF-e. Esse mesmo campo é a chave natural pra identificar o comprador entre compras diferentes, sem exigir login.
- **O checkout é inteiramente customizado, não usa o pipeline padrão de carrinho/Promotions do Medusa.** `api/store/checkout/preference/route.ts` calcula frete, faz split por vendedor (`groupItemsBySeller`) e monta o total manualmente antes de criar a preferência no MercadoPago — não existe carrinho persistente do Medusa nem uso do módulo `Promotion` em nenhum lugar do código (confirmado: nenhuma ocorrência de `promotion` em `src/`).
- **Pedido já sai com `seller_id` correto por grupo** (desde `2026-08-27-multi-seller-cart-order-split-design.md`) — irrelevante pra este design, mas confirma que o padrão de "resolver tudo no backend, nunca confiar em dado do cliente" já é a norma estabelecida no checkout.

## Goal

Comprador ganha pontos automaticamente a cada compra concluída (proporcional ao valor gasto), identificado só pelo CPF/CNPJ já coletado — sem conta. No checkout seguinte, pode consultar o saldo por esse mesmo documento e resgatar pontos como desconto direto no total, antes de pagar.

## Non-Goals

- **Não introduz conta de comprador.**
- **Não usa o módulo `Promotion` do Medusa** — o checkout já é customizado o bastante que enfiar um motor de regras genérico ali seria mais complexo que resolver o desconto na própria rota, do mesmo jeito que frete e split já são calculados manualmente.
- **Não é um programa por vendedor** — é único da plataforma: pontos ganhos em qualquer loja, resgatáveis em qualquer compra futura, decisão já tomada pelo usuário.
- **Não lida com estorno/cancelamento de pedido revertendo pontos** — fica para uma iteração futura; primeira versão assume que pedido concluído é definitivo.

## Design

### Módulo `loyalty`

Novo módulo Medusa (`src/modules/loyalty/`), seguindo o padrão de `review`/`seller`: model `PointsLedgerEntry` (nunca um saldo armazenado direto — o saldo é a soma das entradas):

```ts
const PointsLedgerEntry = model.define("points_ledger_entry", {
  id: model.id().primaryKey(),
  buyerDocument: model.text(), // CPF/CNPJ normalizado (só dígitos), mesma forma de buyer_document
  orderId: model.text().nullable(), // presente quando type = "earn"; null quando type = "redeem"
  type: model.enum(["earn", "redeem"]),
  points: model.number(), // positivo em "earn", negativo em "redeem"
})
```

Índice em `buyerDocument` (consulta de saldo é sempre por esse campo). Saldo = `SUM(points) WHERE buyerDocument = X` — calculado na consulta, nunca cacheado num campo separado (mesmo raciocínio de "nota média calculada na hora" do design de avaliações, evita saldo dessincronizado do ledger).

### Ganho de pontos — `subscribers/order-loyalty-credit.ts`, evento `order.completed`

Lê `order.metadata.buyer_document` e `order.total` (mesma whitelist `select` de `order-fiscal-emit.ts`), credita `Math.floor(total / 100)` pontos (proposta: 1 ponto a cada R$1 — ajustável, é só uma constante) via `createPointsLedgerEntries({ buyerDocument, orderId: order.id, type: "earn", points })`. Sem `buyer_document` no pedido (não deveria acontecer, já é obrigatório no checkout, mas por segurança) → não credita, sem erro.

### Consulta de saldo — `GET /store/loyalty/balance/{document}`

Rota pública, sem autenticação (mesmo padrão de `GET /store/products/{id}/reviews`) — soma as entradas do ledger pra aquele `buyerDocument` normalizado e retorna `{ balance: number }`. CPF sem histórico → `{ balance: 0 }`, não erro.

### Resgate — dentro de `POST /store/checkout/preference`

Novo campo opcional no schema Zod existente: `redeemPoints: z.number().int().nonnegative().optional()`. Se presente:
1. Consulta o saldo atual do `buyerDocument` (mesma soma da rota de consulta).
2. Se `redeemPoints > saldo` → `400` com mensagem clara ("Saldo de pontos insuficiente").
3. Converte pontos em desconto (proposta: 1 ponto = R$0,01 — mesma taxa inversa do ganho, ajustável) e subtrai do `total` já calculado, antes de montar a preferência do MercadoPago.
4. Cria uma entrada `type: "redeem", points: -redeemPoints, orderId: null` no ledger **antes** de criar a preferência (reserva otimista) — se a criação da preferência falhar depois, é um caso raro que fica para tratamento manual (mesmo nível de robustez que o resto dessa rota hoje, que já não é transacional entre passos).

### Testes

- Módulo/service do `loyalty` (padrão do módulo `review`).
- Subscriber de crédito (credita certo, não credita sem `buyer_document`).
- Rota de consulta de saldo (soma correta, zero sem histórico).
- Resgate no checkout: desconto aplicado corretamente ao total, rejeição de saldo insuficiente, entrada de resgate criada no ledger.
