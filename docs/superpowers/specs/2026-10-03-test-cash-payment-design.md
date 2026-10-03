# Pagamento em dinheiro de teste — Design

**Data:** 2026-10-03
**Status:** aprovado em conversa, aguardando revisão da spec escrita
**Branch:** `feature/test-cash-payment`

## 1. Objetivo

Oferecer uma forma de pagamento "Dinheiro (teste)" que permita percorrer o
checkout completo (endereço → frete → pedido criado → WhatsApp → comissão)
**sem depender do Mercado Pago**, contornando a instabilidade das chaves de
teste do MP.

### Critérios de sucesso

- Em ambientes de teste (servidor OCI de testes, desenvolvimento local e futuros
  testes automatizados), a opção aparece no checkout e gera pedidos reais no
  Medusa sem nenhuma chamada ao MP.
- Em produção, a opção **não aparece** e a rota do backend **não existe** (404),
  mesmo que alguém a chame diretamente.
- Pedidos de teste disparam WhatsApp e comissão, mas **não** emitem NF-e.

### Fora de escopo

- Suíte E2E (Playwright/Cypress) — ciclo de spec/plano próprio. Este ciclo só
  deixa o fluxo pronto para automação (`data-testid`, sem iframe do MP).
- Migração do checkout para o Payment Module do Medusa.

## 2. Contexto e restrições encontradas

1. A etapa "Ir para pagamento" já chama o MP: `POST /store/checkout/preference`
   cria a preferência antes de exibir o Brick e retorna 503 sem
   `MERCADOPAGO_ACCESS_TOKEN`. O fluxo de teste não pode passar por essa rota.
2. Os pedidos hoje só são criados no webhook do MP
   (`src/api/webhooks/mercadopago/route.ts`).
3. `MARKETPLACE_SANDBOX` existe, mas o `docker-compose.prod.yml` usa `true` por
   padrão — não serve, sozinho, como trava de produção.
4. Comissão (`commission-on-payment`) e NF-e (`order-fiscal-emit`) escutam o
   mesmo evento `mercadopago.order_approved`.
5. Comissão e WhatsApp agrupam pedidos irmãos (multi-vendedor) por
   `metadata.mercadopago_external_reference`.

## 3. Abordagem escolhida

Rota própria no backend, protegida por flag lida **em tempo de execução**. O
storefront descobre se a opção está habilitada consultando o backend — não há
flag `NEXT_PUBLIC_*` gravada no build, eliminando o risco de uma imagem de teste
promovida para produção exibir a opção.

Alternativas descartadas:
- Flag de build no storefront + flag no backend: duas flags a sincronizar, a do
  storefront fica gravada na imagem.
- Provedor fake no Payment Module do Medusa: o checkout atual não usa o Payment
  Module; reestruturação desproporcional.

## 4. Backend (`packages/medusa-backend/apps/backend`)

### 4.1 Trava — `src/utils/test-cash.ts`

```ts
export function isTestCashEnabled(): boolean {
  return process.env.TEST_CASH_PAYMENT_ENABLED === "true" && isSandboxMode()
}
```

Trava dupla: flag explícita **e** modo sandbox. Padrão desligado.

`validateEnv` ganha uma regra: `TEST_CASH_PAYMENT_ENABLED=true` com
`MARKETPLACE_SANDBOX=false` lança erro na inicialização (configuração
contraditória falha alto, não é ignorada em silêncio).

### 4.2 Função compartilhada — `src/utils/create-orders-from-checkout.ts`

Extraída do webhook do MP (bloco que vai de `sellerGroups` até `createOrders`).

```ts
createOrdersFromCheckout({
  container,          // req.scope
  externalReference,  // referência do checkout
  meta,               // payload do snapshot (seller_groups, address, items, shipping, buyer_document)
  extraMetadata,      // ex.: { mercadopago_payment_id } ou { payment_method: "test_cash" }
  fallbackPayer?,     // dados do payer do MP, usados só pelo webhook como fallback de endereço
}): Promise<Order[]>
```

- Mantém a idempotência atual: só cria pedidos para os grupos de vendedor que
  ainda não têm pedido com aquele `mercadopago_external_reference` + `seller_id`.
- Retorna apenas os pedidos criados; **quem chama emite os eventos**.
- O webhook passa a usá-la sem mudança de comportamento observável.

### 4.3 Schema e snapshot compartilhados

O schema zod da preference e a montagem do `checkoutSnapshotPayload`
(incluindo a resolução de vendedor por produto e `groupItemsBySeller`) são
extraídos para um módulo compartilhado (ex.:
`src/api/store/checkout/checkout-payload.ts`), usado pela rota de preference e
pela nova rota. Nenhuma duplicação de validação.

### 4.4 Rotas — `src/api/store/checkout/test-cash/route.ts`

**`GET /store/checkout/test-cash`** → `200 { enabled: boolean }`. Nunca falha.

**`POST /store/checkout/test-cash`**
- Trava desligada → `404` (indistinguível de rota inexistente).
- Corpo: o mesmo da preference (`items`, `address`, `shipping`, `total`, `document`).
- Passos:
  1. valida com o schema compartilhado → `400` se inválido;
  2. resolve vendedores e monta o snapshot → `400` se produto sem vendedor;
  3. gera `externalReference` (`crypto.randomUUID()`) e grava o snapshot no
     `checkoutService` → `500` se falhar;
  4. chama `createOrdersFromCheckout` com
     `extraMetadata: { payment_method: "test_cash" }`;
  5. emite, por pedido, `order.placed` e `test_cash.order_approved`;
  6. responde `200 { external_reference }`.
- **Não** exige `MERCADOPAGO_ACCESS_TOKEN` e não importa o SDK do MP.

### 4.5 Metadados dos pedidos de teste

| Chave | Valor |
|---|---|
| `mercadopago_external_reference` | referência do checkout (nome mantido para que comissão e WhatsApp agrupem pedidos irmãos sem alteração) |
| `seller_id` | vendedor do grupo |
| `buyer_document` | documento do comprador |
| `payment_method` | `"test_cash"` |
| `mercadopago_payment_id` | ausente |

### 4.6 Subscribers

- `commission-on-payment`: `event` passa a incluir `test_cash.order_approved`.
- `order-fiscal-emit`: inalterado → pedidos de teste não emitem NF-e.
- `order-placed-whatsapp`: inalterado (já escuta `order.placed`).

### 4.7 Configuração / deploy

- `infra/docker-compose.oci.yml` (servidor de testes):
  `TEST_CASH_PAYMENT_ENABLED: ${TEST_CASH_PAYMENT_ENABLED:-false}`.
- `.env.example` do backend: variável documentada, comentada como "somente
  testes".
- `infra/docker-compose.prod.yml`: **não declara** a variável.
- `docs/DEPLOY_OCI.md`: como habilitar no servidor de testes.

## 5. Storefront (`apps/storefront`)

### 5.1 Descoberta — `src/lib/test-cash.ts`

`fetchTestCashEnabled(): Promise<boolean>` chama o `GET`. Qualquer falha (rede,
status ≠ 200, JSON inválido) → `false`.

### 5.2 Checkout — `src/app/checkout/page.tsx`

- Ao montar, consulta `fetchTestCashEnabled()`.
- Na etapa **Entrega**, se habilitado, exibe abaixo das opções de frete um bloco
  "Forma de pagamento" com dois rádios:
  - "Cartão / Pix (Mercado Pago)" — padrão, `data-testid="payment-method-mp"`;
  - "Dinheiro (teste)" + selo **AMBIENTE DE TESTE**,
    `data-testid="payment-method-test-cash"`.
- Desabilitado → bloco não renderizado; fluxo idêntico ao atual.
- Com "Dinheiro (teste)" selecionado, o botão vira "Finalizar pedido (teste)"
  (`data-testid="submit-test-cash"`) e chama `createTestCashOrder` (novo, em
  `src/app/checkout/create-test-cash-order.ts`, mesma assinatura de
  `createPreference`).
  - Sucesso → `setPaid(true)`, `clear()`,
    `router.push('/checkout/sucesso?test_cash=<ref>')`.
  - Erro → mensagem na própria etapa, mesmo padrão do erro de preference.
- A etapa Pagamento (Brick) é pulada; nenhuma chamada ao MP.

### 5.3 Página de sucesso — `src/app/checkout/sucesso/ConfirmationContent.tsx`

- Com `?test_cash=<ref>`: não chama `/store/checkout/confirm`; exibe "Pedido
  confirmado!", a referência e a nota "pagamento em dinheiro (teste)".
- Status exposto em `data-testid="confirmation-status"`.
- Caminho `payment_id` inalterado.

## 6. Tratamento de erros

| Situação | Comportamento |
|---|---|
| Flag ligada + `MARKETPLACE_SANDBOX=false` | backend não inicializa (`validateEnv`) |
| Flag desligada, `POST` direto | `404` |
| `GET` falha no storefront | opção oculta |
| Payload inválido / produto sem vendedor | `400`, mensagem exibida na etapa Entrega |
| Falha ao gravar snapshot ou criar pedidos | `500`, mensagem exibida; nenhum evento emitido |

## 7. Testes

### Backend (Jest unit, padrão `__tests__` existente)
- `isTestCashEnabled`: matriz flag × sandbox.
- `validateEnv`: rejeita flag ligada com `MARKETPLACE_SANDBOX=false`.
- `createOrdersFromCheckout`: criação por vendedor, idempotência, metadados extras.
- Webhook MP: testes existentes continuam verdes após a refatoração.
- Rota `test-cash`:
  - `GET` ligado/desligado;
  - `POST` desligado → 404;
  - `POST` ligado → snapshot gravado, pedidos com `payment_method: "test_cash"`,
    eventos `order.placed` + `test_cash.order_approved`, **sem**
    `mercadopago.order_approved`;
  - payload inválido → 400.
- Configs de subscriber: comissão inclui `test_cash.order_approved`; NF-e não.

### Storefront (Vitest)
- Seletor oculto quando `GET` retorna `false` ou falha; visível quando `true`.
- "Dinheiro (teste)" chama a rota nova e redireciona com `?test_cash=`.
- Sucesso com `test_cash` não chama `/confirm`.
