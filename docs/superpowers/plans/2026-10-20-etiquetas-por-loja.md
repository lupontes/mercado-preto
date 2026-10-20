# Etiquetas por Loja Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois do pagamento aprovado, comprar no Melhor Envio uma etiqueta por pedido de loja, entregá-la à lojista (WhatsApp, e-mail e portal), acompanhar o rastreio até "Entregue" e tirar o frete do repasse.

**Architecture:** Um cliente Melhor Envio de etiquetas (`utils/melhor-envio-labels.ts`) e funções puras de payload e de transição de rastreio. Um serviço idempotente (`utils/shipping-label.ts`) faz a compra e é chamado por um subscriber, pelo admin ("comprar de novo") e por nada mais. O estado fica em `order.metadata.shipping_label`. Um job a cada 2 h consulta o rastreio e manda lembretes. Uma rota de webhook reaproveita a mesma transição.

**Tech Stack:** Medusa v2 (subscribers, jobs, rotas em `src/api`), TypeScript, jest (`TEST_TYPE=unit`), Next.js 15 + vitest na vitrine, admin SDK do Medusa.

**Spec:** `docs/superpowers/specs/2026-10-20-etiquetas-por-loja-design.md`

## Global Constraints

- Código, nomes e comentários em inglês. Textos para usuários em português.
- Tudo atrás de `MELHOR_ENVIO_LABELS_ENABLED=true`. Desligado, o comportamento é o de hoje.
- Ler `metadata` de pedido exige `select: ["metadata", ...]` no `retrieveOrder`/`listOrders` (pegadinha documentada em `subscribers/commission-on-payment.ts`).
- `updateOrders` sempre recebe o objeto `metadata` inteiro (`{ ...order.metadata, ...novo }`), nunca parcial.
- WhatsApp por `utils/whatsapp.ts` (`sendWhatsApp`) e e-mail por `utils/email.ts` (`sendBrevoEmail`). Os dois já desviam para os destinatários de teste em sandbox.
- Base da API Melhor Envio: `https://sandbox.melhorenvio.com.br` com `MARKETPLACE_SANDBOX !== "false"`, senão `https://melhorenvio.com.br`. Mesmo `User-Agent` de `utils/melhor-envio.ts`.
- Validade do link da etiqueta: 20 dias (`LABEL_LINK_TTL_SECONDS = 20 * 24 * 60 * 60`).
- Prazo de postagem: `SHIPPING_HANDLING_DAYS` dias úteis depois da geração (`handlingDaysFromEnv()` de `utils/shipping-quote.ts`).
- Testes antes do código. Backend: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest <caminho>`. Vitrine: `cd apps/storefront && npx vitest run <caminho>`.
- Commits em Conventional Commits, descrição em português, minúscula, imperativo.
- Os caminhos e campos da API Melhor Envio citados aqui (`/me/cart`, `/me/shipment/checkout|generate|print|tracking|cancel`) vêm da documentação de 20/10/2026. Confirme cada um no sandbox (Task 13) antes de dar a task 3 por encerrada; diferença de nome de campo se corrige no cliente, não no resto do código.

## Review Focus

1. **O mesmo pedido aprovado duas vezes** (o Mercado Pago repete webhooks): só pode existir **uma** etiqueta paga. Teste na Task 5: duas chamadas concorrentes de `purchaseShippingLabel` para o mesmo pedido chamam `addToCart` uma vez.
2. **Pedido antigo sem número, bairro ou documento do comprador:** a compra termina em `failed` com o motivo em português, sem exceção não tratada. Teste na Task 5.
3. **Loja com endereço incompleto:** `failed` com "Endereço de envio da loja incompleto", sem chamar o Melhor Envio. Teste na Task 5.
4. **Link de etiqueta adulterado, expirado ou de pedido sem etiqueta gerada:** 404 com texto simples, sem redirecionar e sem vazar URL do Melhor Envio. Teste na Task 6.
5. **Rastreio com status desconhecido ou Melhor Envio fora do ar no job:** o job segue para os outros pedidos e nenhum status anda para trás. Teste nas Tasks 9 e 10.

---

### Task 1: Número e bairro do comprador no backend

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/utils/checkout-payload.ts` (schema `address` e montagem do snapshot)
- Modify: `packages/medusa-backend/apps/backend/src/utils/create-orders-from-checkout.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/checkout-payload.unit.spec.ts`, `.../create-orders-from-checkout.unit.spec.ts` (o arquivo de teste existente desse util)

**Interfaces:**
- Produces: `checkoutRequestSchema.address` com `number: string` (min 1) e `district: string` (min 1); snapshot `address.number` e `address.district`; pedido com `metadata.address_number` e `metadata.address_district`.

- [ ] **Step 1: Testes que falham**
  - `checkoutRequestSchema` rejeita `address` sem `number` ou sem `district`, ou com eles vazios.
  - `buildCheckoutSnapshot` grava `address.number === "1000"` e `address.district === "Bela Vista"`.
  - `createOrdersFromCheckout` cria o pedido com `metadata.address_number === "1000"` e `metadata.address_district === "Bela Vista"`; snapshot antigo sem esses campos cria o pedido sem as chaves (não grava `undefined`).
  - Atualize os fixtures existentes que montam `address` para incluir os dois campos.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. O `shipping_address` do Medusa não muda.
- [ ] **Step 4:** Rodar os testes do arquivo e a suíte unitária inteira do backend.
- [ ] **Step 5: Commit** `feat(checkout): exigir número e bairro do endereço do comprador`

### Task 2: Número e bairro no checkout da vitrine

**Files:**
- Modify: `apps/storefront/src/app/checkout/create-preference.ts` (tipo `Address`)
- Modify: `apps/storefront/src/app/checkout/page.tsx` (`EMPTY_ADDRESS`, ViaCEP, campos)
- Modify: testes da vitrine que localizam inputs por índice (`quote-retry.test.tsx`, `loyalty-summary.test.tsx`, `checkout-test-cash.test.tsx` e outros que usem `querySelectorAll('form input')[n]`)
- Test: `apps/storefront/src/app/checkout/__tests__/address-number-district.test.tsx`

**Interfaces:**
- Consumes: Task 1 (o backend exige `number` e `district`).
- Produces: `Address` com `number: string` e `district: string`, enviados em `buildCheckoutRequestBody`.

- [ ] **Step 1: Testes que falham**
  - Os campos "Número *" e "Bairro *" aparecem depois de "Endereço *".
  - Com a resposta do ViaCEP `{ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" }`, o campo Bairro vem preenchido com "Bela Vista" e Número continua vazio.
  - "Calcular frete" com Número vazio não avança e mostra "Informe o número." (mesma forma de erro dos outros campos obrigatórios).
  - `buildCheckoutRequestBody` leva `address.number` e `address.district`.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. Prefira localizar inputs por rótulo nos testes ajustados, para não depender de índice de novo.
- [ ] **Step 4:** `npx vitest run` (vitrine inteira) e `npx tsc --noEmit -p .`
- [ ] **Step 5: Commit** `feat(checkout): pedir número e bairro na etapa de endereço`

### Task 3: Cliente Melhor Envio de etiquetas

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/melhor-envio-labels.ts`
- Modify: `packages/medusa-backend/apps/backend/src/utils/melhor-envio.ts` (`ServiceQuote` ganha `packages`)
- Test: `.../utils/__tests__/melhor-envio-labels.unit.spec.ts`, `.../utils/__tests__/melhor-envio.unit.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LabelVolume = { weight: number; length: number; width: number; height: number }
  export type CartRequest = Record<string, unknown> // body pronto, montado na Task 4
  export type TrackingInfo = { status: string; trackingCode: string | null; postedAt: string | null; deliveredAt: string | null }
  export type LabelClient = {
    addToCart(body: CartRequest): Promise<{ id: string; price: number }>   // price em centavos
    checkout(ids: string[]): Promise<void>
    generate(ids: string[]): Promise<void>
    printUrl(ids: string[]): Promise<string>                                // mode "private"
    tracking(ids: string[]): Promise<Record<string, TrackingInfo>>
    cancel(id: string): Promise<void>
  }
  export class MelhorEnvioError extends Error { status: number; body: string }
  export function createLabelClient(opts: { token: string; sandbox: boolean; timeoutMs?: number; fetchImpl?: typeof fetch }): LabelClient
  export function getLabelClient(env?: NodeJS.ProcessEnv): LabelClient | null  // null sem MELHOR_ENVIO_TOKEN
  ```
  - `ServiceQuote.packages?: LabelVolume[]`, lido do `packages[].dimensions` + `weight` da resposta de `/me/shipment/calculate`.

- [ ] **Step 1: Testes que falham** (com `fetchImpl` de teste que registra as chamadas, como em `melhor-envio.unit.spec.ts`)
  - `addToCart` faz `POST {base}/api/v2/me/cart` com `Authorization: Bearer <token>` e devolve `{ id, price: 2150 }` para `{ id: "abc", price: "21.50" }`.
  - `checkout`, `generate` e `printUrl` fazem `POST` em `/me/shipment/checkout`, `/me/shipment/generate` e `/me/shipment/print` com `{ orders: ids }`; `printUrl` devolve o `url` da resposta.
  - `tracking` converte a resposta por id em `TrackingInfo` (`tracking` → `trackingCode`).
  - `cancel` chama `/me/shipment/cancel` com `{ order: { id, reason_id: "2", description: "Pedido cancelado" } }`.
  - Resposta não-2xx lança `MelhorEnvioError` com `status` e o corpo; o token nunca aparece em `message`.
  - `getLabelClient({})` devolve `null`; com `MARKETPLACE_SANDBOX: "false"` usa a base de produção.
  - O calculador de cotação passa a devolver `packages` quando a resposta traz.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. Tempo limite padrão de 15 s por chamada.
- [ ] **Step 4:** Rodar os dois arquivos e a suíte unitária inteira.
- [ ] **Step 5: Commit** `feat(frete): adicionar cliente de etiquetas do melhor envio`

### Task 4: Montagem do pedido de etiqueta

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/shipping-label-payload.ts`
- Test: `.../utils/__tests__/shipping-label-payload.unit.spec.ts`

**Interfaces:**
- Consumes: `LabelVolume`, `CartRequest` (Task 3); `hasShippingOrigin` de `utils/seller-address.ts`.
- Produces:
  ```ts
  export type LabelOrder = {
    displayId: number; serviceId: number; email: string; buyerDocument: string | null
    address: { firstName: string; lastName: string; phone: string; street: string; number: string | null; complement: string; district: string | null; city: string; state: string; postalCode: string }
    items: Array<{ title: string; quantity: number; unitPrice: number }>  // centavos
  }
  export type LabelSeller = { name: string; phone: string; email: string; cpfCnpj: string; address: { postalCode, street, number, complement, district, city, state } (string | null cada) }
  export function buildCartRequest(order: LabelOrder, seller: LabelSeller, volume: LabelVolume): { ok: true; body: CartRequest } | { ok: false; reason: string }
  ```

- [ ] **Step 1: Testes que falham**
  - Body com `service`, `from` (nome da loja, telefone, e-mail, `document` só dígitos, endereço), `to` (nome completo, telefone, e-mail, `document`, rua, `number`, `complement`, `district`, cidade, UF, CEP), `products` (`name`, `quantity`, `unitary_value` em reais), `volumes: [volume]`, `options: { insurance_value: <soma em reais>, receipt: false, own_hand: false, reverse: false, non_commercial: true, tags: [{ tag: "Pedido #<displayId>" }] }`.
  - CPF de 11 dígitos e CNPJ de 14 dígitos vão em `document` (o Melhor Envio aceita os dois no mesmo campo; confirmar no sandbox).
  - Motivos, em português, com `ok: false`:
    - sem `buyerDocument` → "CPF/CNPJ do comprador ausente";
    - sem `number` ou `district` → "Número ou bairro do comprador ausente";
    - loja sem endereço completo → "Endereço de envio da loja incompleto".
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar como função pura.
- [ ] **Step 4:** Rodar o arquivo.
- [ ] **Step 5: Commit** `feat(frete): montar o pedido de etiqueta a partir do pedido e da loja`

### Task 5: Compra idempotente da etiqueta

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/shipping-label.ts`
- Test: `.../utils/__tests__/shipping-label.unit.spec.ts`

**Interfaces:**
- Consumes: Tasks 3 e 4; `ShippingCalculator` (`utils/melhor-envio.ts`); `addBusinessDays` (abaixo).
- Produces:
  ```ts
  export type ShippingLabelStatus = "pending" | "generated" | "failed" | "canceled"
  export type ShippingLabelState = {
    status: ShippingLabelStatus; meOrderIds: string[]; price: number | null
    trackingCode: string | null; generatedAt: string | null; postBy: string | null  // ISO
    reminderSentAt: string | null; error: string | null
  }
  export function addBusinessDays(from: Date, days: number): Date      // pula sábado e domingo
  export function labelsEnabled(env?: NodeJS.ProcessEnv): boolean       // MELHOR_ENVIO_LABELS_ENABLED === "true"
  export async function purchaseShippingLabel(deps: {
    orderService: { retrieveOrder; updateOrders }; sellerService: { retrieveSeller }
    labels: LabelClient; calculator: ShippingCalculator; now?: () => Date; handlingDays?: number
  }, orderId: string): Promise<ShippingLabelState>
  ```
  - Lê o pedido com `relations: ["items", "shipping_address"]` e `select: ["metadata", "display_id", "email"]`.
  - Volumes: cota de novo (`calculator`) da loja para o CEP do comprador com os itens do pedido, pega o serviço `shipping_service_id` e usa `packages`. Sem `packages`, um volume com o tamanho `medium` de `utils/package-size.ts`. Vários pacotes → uma entrada no carrinho por pacote.

- [ ] **Step 1: Testes que falham** (dependências em memória, sem banco)
  - Caminho feliz: grava `status: "generated"`, `meOrderIds`, `price` (soma dos carrinhos), `generatedAt` e `postBy = addBusinessDays(generatedAt, handlingDays)`; chama `addToCart → checkout → generate` nessa ordem.
  - Antes de chamar o Melhor Envio, grava `status: "pending"`. Uma segunda chamada com o pedido em `pending` ou `generated` não chama `addToCart` e devolve o estado atual. **(Review Focus 1)**: duas chamadas concorrentes `Promise.all([...])` resultam em uma única chamada de `addToCart`.
  - `failed` pode ser repetido: com estado `failed`, a chamada compra de novo.
  - `buildCartRequest` com `ok: false` → `failed` com o motivo, sem chamar o Melhor Envio. **(Review Focus 2 e 3)**
  - `MelhorEnvioError` em qualquer etapa → `failed` com `error` = "Melhor Envio: <status>" mais o trecho de `message` do corpo, sem token; se o carrinho já tinha ids, eles ficam em `meOrderIds`.
  - `addBusinessDays(new Date("2026-10-23T12:00:00Z"), 2)` (sexta) → terça `2026-10-27`.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. A trava contra concorrência: uma `Map<orderId, Promise>` em memória no processo, mais o `pending` persistido (o backend roda num processo só).
- [ ] **Step 4:** Rodar o arquivo e a suíte unitária.
- [ ] **Step 5: Commit** `feat(frete): comprar a etiqueta de forma idempotente`

### Task 6: Link assinado da etiqueta

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/label-token.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/labels/[token]/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/seller/orders/[id]/label/route.ts`
- Test: `.../utils/__tests__/label-token.unit.spec.ts`, `.../api/labels/[token]/__tests__/route.unit.spec.ts`, `.../api/seller/orders/[id]/label/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `LabelClient.printUrl` (Task 3), `ShippingLabelState` (Task 5).
- Produces:
  ```ts
  export function signLabelToken(orderId: string, now?: Date): string   // escopo "label", exp = now + LABEL_LINK_TTL_SECONDS
  export function verifyLabelToken(token: string): { orderId: string } | null
  export function labelLink(orderId: string): string                    // `${process.env.BACKEND_URL}/labels/${token}`
  ```
  - Mesma técnica de `utils/loyalty-token.ts` (HMAC com `JWT_SECRET`, `timingSafeEqual`, sem fallback de segredo em produção), com `scope: "label"`.

- [ ] **Step 1: Testes que falham**
  - Token válido devolve o `orderId`; token de loyalty ou de vendedora não serve (escopo); expirado ou com assinatura trocada → `null`.
  - `GET /labels/:token`: token válido e pedido com `shipping_label.status === "generated"` → `302` para o `url` do `printUrl(meOrderIds)`. **(Review Focus 4)** Token inválido, expirado, ou pedido sem etiqueta gerada → `404` com o texto "Etiqueta não encontrada ou expirada.", sem `Location`.
  - `GET /seller/orders/:id/label`: pedido de outra loja → `404`; pedido da loja com etiqueta gerada → `302`.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. A rota `/labels` é pública (sem middleware); a de vendedora já passa pelo `sellerAuth` do matcher `/seller`, que cobre as sub-rotas (`api/middlewares.ts`).
- [ ] **Step 4:** Rodar os três arquivos.
- [ ] **Step 5: Commit** `feat(frete): adicionar link assinado para imprimir a etiqueta`

### Task 7: Aviso à lojista e alerta à equipe

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/shipping-label-notify.ts`
- Test: `.../utils/__tests__/shipping-label-notify.unit.spec.ts`

**Interfaces:**
- Consumes: `labelLink` (Task 6), `ShippingLabelState` (Task 5), `sendWhatsApp`, `sendBrevoEmail`.
- Produces:
  ```ts
  export async function notifySellerLabelReady(seller: { name: string; phone: string; email: string }, order: { id: string; displayId: number }, state: ShippingLabelState): Promise<void>
  export async function notifySellerPostingReminder(seller: { name: string; phone: string }, order: { id: string; displayId: number }, state: ShippingLabelState): Promise<void>
  export async function alertTeamLabelFailed(order: { id: string; displayId: number }, state: ShippingLabelState): Promise<void>  // ADMIN_ALERT_EMAIL; sem a variável, só console.error
  ```
- Textos fixados:
  - pronta (WhatsApp e e-mail): "🛍️ Nova venda no Mercado Preto! Pedido #<N>.\n\nImprima a etiqueta, cole na caixa e poste nos Correios até <DD/MM>:\n<link>\n\n_Mercado Preto_"
  - lembrete (WhatsApp): "⏰ Lembrete: o pedido #<N> precisa ser postado nos Correios até hoje (<DD/MM>). Etiqueta: <link>"
  - alerta (e-mail, assunto "Etiqueta não comprada — pedido #<N>"): motivo e link do pedido no admin (`${BACKEND_URL}/app/orders/<id>`).

- [ ] **Step 1: Testes que falham** com os textos acima, data em `America/Sao_Paulo`, e o link da Task 6. Os testes substituem `sendWhatsApp`/`sendBrevoEmail` por `jest.mock` dos módulos (são fronteira externa).
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar o arquivo.
- [ ] **Step 5: Commit** `feat(frete): avisar a lojista da etiqueta e a equipe das falhas`

### Task 8: Marca `platform_label`, subscriber de compra e repasse sem frete

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts` (passa `platform_label: labelsEnabled()` em `extraMetadata`)
- Create: `packages/medusa-backend/apps/backend/src/subscribers/order-shipping-label.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts`
- Test: `.../subscribers/__tests__/order-shipping-label.unit.spec.ts`, `.../subscribers/__tests__/commission-on-payment.unit.spec.ts`, teste existente do webhook do Mercado Pago

**Interfaces:**
- Consumes: Tasks 5 e 7.
- Produces: pedidos do checkout Mercado Pago com `metadata.platform_label === true` quando a flag está ligada. O "Dinheiro (teste)" (`sandbox-cash`) não recebe a marca.

- [ ] **Step 1: Testes que falham**
  - Webhook: com `MELHOR_ENVIO_LABELS_ENABLED=true`, os pedidos criados têm `platform_label: true`; sem a variável, não têm a chave.
  - Subscriber em `mercadopago.order_approved`: com `platform_label` e `shipping_service_id`, chama `purchaseShippingLabel` e, em `generated`, `notifySellerLabelReady`; em `failed`, `alertTeamLabelFailed`. Sem a marca, ou com a flag desligada, ou sem cliente (`getLabelClient()` nulo), não faz nada.
  - Comissão: pedido com `platform_label: true` e frete de R$ 69,81 → `sellerPayout` sem os 6981; pedido sem a marca → igual a hoje.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. Na comissão, só troque o `shippingAmount` passado ao `recordAndCreate` por `0` quando `order.metadata?.platform_label === true`.
- [ ] **Step 4:** Rodar os arquivos e a suíte unitária inteira.
- [ ] **Step 5: Commit** `feat(frete): comprar a etiqueta após o pagamento e tirar o frete do repasse`

### Task 9: Transição de rastreio

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/shipping-label-tracking.ts`
- Test: `.../utils/__tests__/shipping-label-tracking.unit.spec.ts`

**Interfaces:**
- Consumes: `TrackingInfo` (Task 3), `ShippingStatus` (`utils/shipping-status.ts`), `ShippingLabelState` (Task 5).
- Produces:
  ```ts
  export function applyTracking(current: { shippingStatus: ShippingStatus; orderStatus: string; label: ShippingLabelState }, info: TrackingInfo):
    { shippingStatus: ShippingStatus; label: ShippingLabelState; shipmentCreated: boolean }
  ```
  - `posted` → `shipped` (grava `trackingCode`; `shipmentCreated: true` só na primeira vez).
  - `delivered` → `delivered` (se ainda não estava `shipped`, também marca `shipmentCreated: true`).
  - `canceled` do Melhor Envio → `label.status = "canceled"`, `shippingStatus` não muda.
  - Qualquer outro status → sem mudança.

- [ ] **Step 1: Testes que falham** para cada linha acima, mais **(Review Focus 5)**: `delivered` nunca volta para `shipped`; pedido com `orderStatus === "canceled"` não muda; status desconhecido ("released", "", `null`) não muda nada.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar como função pura.
- [ ] **Step 4:** Rodar o arquivo.
- [ ] **Step 5: Commit** `feat(frete): calcular o status do pedido a partir do rastreio`

### Task 10: Job de rastreio e lembretes

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/jobs/shipping-label-tracking.ts`
- Test: `.../jobs/__tests__/shipping-label-tracking.unit.spec.ts`

**Interfaces:**
- Consumes: Tasks 3, 7 e 9.
- Produces: `export default async function shippingLabelTracking(container)` e `export const config = { name: "shipping-label-tracking", schedule: "0 */2 * * *" }`, no padrão de `jobs/mercadolivre-token-refresh.ts`.
  - Seleciona pedidos com `metadata.shipping_label.status === "generated"` e `shipping_status !== "delivered"` (filtrar em memória depois de `listOrders` paginado com `select: ["id", "status", "display_id", "metadata"]`, se o filtro por JSON aninhado não funcionar).
  - Chama `tracking` em lotes de até 50 ids, aplica `applyTracking`, grava, e emite `order.shipment_created` com `{ id, tracking_number }` quando `shipmentCreated`.
  - Lembrete: se não postado e hoje (America/Sao_Paulo) for o dia de `postBy` e `reminderSentAt` vazio, chama `notifySellerPostingReminder` e grava `reminderSentAt`.

- [ ] **Step 1: Testes que falham**
  - Pedido postado → `shipping_status: "shipped"` gravado com o metadata inteiro, evento emitido uma vez.
  - **(Review Focus 5)** `tracking` lançando erro num lote não impede o próximo lote; o erro vai para o logger.
  - Lembrete enviado uma vez no dia do prazo e nunca no dia anterior; não reenvia com `reminderSentAt` preenchido.
  - Flag desligada ou sem cliente → não faz nada.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar o arquivo e a suíte unitária.
- [ ] **Step 5: Commit** `feat(frete): acompanhar o rastreio e lembrar a postagem`

### Task 11: Webhook do Melhor Envio

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/webhooks/melhor-envio/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/middlewares.ts` (corpo bruto para a assinatura, como no webhook do Mercado Pago, se ele precisar)
- Test: `.../api/webhooks/melhor-envio/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `applyTracking` (Task 9).
- Produces: `POST /webhooks/melhor-envio`. Valida `X-ME-Signature` = base64 do HMAC-SHA256 do corpo bruto com `MELHOR_ENVIO_WEBHOOK_SECRET` (confirmar na doc se é base64 ou hex); sem segredo configurado → `503`. Localiza o pedido pelo id da etiqueta (`data.id`) em `shipping_label.meOrderIds`. Eventos `order.posted`, `order.delivered`, `order.cancelled` viram `TrackingInfo` e passam por `applyTracking`.

- [ ] **Step 1: Testes que falham**: assinatura válida aplica a transição e responde `200`; assinatura inválida → `401` sem tocar no pedido; id desconhecido → `200` sem efeito (o Melhor Envio não precisa reenviar).
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar o arquivo.
- [ ] **Step 5: Commit** `feat(frete): receber o rastreio por webhook do melhor envio`

### Task 12: Etiqueta no portal da vendedora e no painel master

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/seller/orders/route.ts` (expõe `shipping_label: { status, tracking_code, post_by } | null`, sem o resto do metadata)
- Create: `packages/medusa-backend/apps/backend/src/api/admin/orders/[id]/shipping-label/route.ts` (`POST` = comprar de novo, só em `failed`; `DELETE` = cancelar, só em `generated` e `shipping_status === "awaiting_shipment"`)
- Modify: `packages/medusa-backend/apps/backend/src/admin/widgets/order-shipping-status.tsx`
- Modify: `apps/storefront/src/lib/seller-api.ts`, `apps/storefront/src/app/painel/pedidos/page.tsx`
- Test: testes das rotas, `.../admin/widgets/__tests__/order-shipping-status.test.tsx`, `apps/storefront/src/app/painel/pedidos/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: Tasks 5, 6, 7 e 3 (`cancel`).

- [ ] **Step 1: Testes que falham**
  - Rota da vendedora devolve `shipping_label` com os três campos e nunca `buyer_document`.
  - Admin `POST` em `failed` chama `purchaseShippingLabel` e, se gerar, `notifySellerLabelReady`; em outro status → `409`. `DELETE` cancela no Melhor Envio e grava `canceled`; postado → `409` "Etiqueta já postada".
  - Widget: mostra status da etiqueta, preço, rastreio, link; botão "Comprar etiqueta de novo" só em `failed`; "Cancelar etiqueta" só em `generated` não postada; "Prazo de postagem vencido" quando `postBy` passou e não postou.
  - Portal, Pedidos: botão "Imprimir etiqueta" (link para `${NEXT_PUBLIC_MEDUSA_URL}/seller/orders/<id>/label`, nova aba) quando `generated`; "Etiqueta em preparação" em `pending`; rastreio e "Postar até DD/MM" quando houver.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Suítes do backend, do admin (com o vitest da vitrine, como hoje) e da vitrine; `tsc --noEmit` nos dois pacotes.
- [ ] **Step 5: Commit** `feat(frete): mostrar a etiqueta no portal e no painel master`

### Task 13: Configuração, documentação e ponta a ponta no servidor de teste

**Files:**
- Modify: `infra/docker-compose.oci.yml` (`MELHOR_ENVIO_LABELS_ENABLED`, `ADMIN_ALERT_EMAIL`, `MELHOR_ENVIO_WEBHOOK_SECRET` no serviço `medusa`)
- Modify: `infra/.env.template`, `docs/DEPLOY_OCI.md` (seção "Etiquetas do Melhor Envio": carteira sandbox com saldo, flag, alerta)
- Modify: `docs/superpowers/specs/2026-10-20-etiquetas-por-loja-design.md` (o que o sandbox mostrou de diferente)

- [ ] **Step 1:** Conferir no sandbox, com `curl` usando o token de dentro do servidor (sem imprimir o token), os caminhos e campos usados nas Tasks 3 e 4; corrigir o cliente se algo diferir, com teste.
- [ ] **Step 2:** PR para `develop`, merge pelo usuário, deploy (`docs/DEPLOY_OCI.md`), flag ligada no `.env.oci` e `ADMIN_ALERT_EMAIL` definido pelo usuário.
- [ ] **Step 3: Ponta a ponta** com o sandbox do Mercado Pago, carrinho com produtos da LOJA FIX e da Mulheres de Axé:
  - duas etiquetas geradas, uma por pedido, com `shipping_label` gravado;
  - o link de cada etiqueta abre o PDF;
  - WhatsApp e e-mail de cada lojista chegam (no Ailton, em sandbox);
  - `sellerPayout` dos dois pedidos sem o frete, conferido no banco;
  - pedido sem número/bairro (antigo) recomprado pelo admin termina em `failed` com o motivo;
  - se o sandbox permitir simular postagem, o job muda o status para "Enviado" e o comprador recebe o WhatsApp com o rastreio.
- [ ] **Step 4:** Registrar o resultado no HANDOFF e avisar o Ailton com o roteiro de teste.
- [ ] **Step 5: Commit** `docs(frete): registrar a configuração e o teste das etiquetas`
