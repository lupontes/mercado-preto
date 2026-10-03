# Pagamento em dinheiro de teste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir finalizar o checkout com "Dinheiro (teste)" sem chamar o Mercado Pago, apenas em ambientes de teste.

**Architecture:** Nova rota `/store/checkout/test-cash` no backend Medusa, protegida por `TEST_CASH_PAYMENT_ENABLED=true` + modo sandbox, que grava o snapshot do checkout e cria os pedidos via uma função extraída do webhook do MP. O storefront descobre em runtime (`GET`) se a opção está habilitada e, se sim, oferece o seletor na etapa de entrega.

**Tech Stack:** Medusa v2 (TypeScript, Jest unit, zod), Next.js 15 / React 19 (Vitest + Testing Library + jsdom), zustand.

**Spec:** `docs/superpowers/specs/2026-10-03-test-cash-payment-design.md`

**Worktree:** `/home/lupontes/repos/marketplace-test-cash` (branch `feature/test-cash-payment`). Todos os caminhos abaixo são relativos a ele. Backend = `packages/medusa-backend/apps/backend`; storefront = `apps/storefront`.

## Global Constraints

- Flag: `TEST_CASH_PAYMENT_ENABLED` — só vale quando o valor é exatamente `"true"` **e** `isSandboxMode()` é verdadeiro.
- Backend não inicializa se `TEST_CASH_PAYMENT_ENABLED=true` e `MARKETPLACE_SANDBOX=false`.
- `POST /store/checkout/test-cash` com trava desligada → `404`. Nunca importa o SDK do MP nem exige `MERCADOPAGO_ACCESS_TOKEN`.
- Pedidos de teste: `metadata.payment_method = "test_cash"`, `metadata.mercadopago_external_reference = <ref do checkout>`, sem `mercadopago_payment_id`.
- Eventos de pedido de teste: `order.placed` + `test_cash.order_approved`. **Nunca** `mercadopago.order_approved` (evita NF-e).
- `infra/docker-compose.prod.yml` **não** declara `TEST_CASH_PAYMENT_ENABLED`.
- Storefront não usa flag `NEXT_PUBLIC_*` para isso; qualquer falha na descoberta = opção oculta.
- `data-testid`: `payment-method-mp`, `payment-method-test-cash`, `submit-test-cash`, `confirmation-status`.
- Código, identificadores e comentários em inglês; textos de UI e mensagens de erro de API em pt-BR (padrão existente). Commits: Conventional Commits com descrição em pt-BR, terminando com:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm
  ```

## Review Focus

1. Flag com valor "quase verdadeiro" (`TRUE`, `1`, `" true"`) → deve ser tratada como **desligada** (Task 1).
2. Duplo clique em "Finalizar pedido (teste)" → o botão fica desabilitado durante o envio, para não gerar dois checkouts/pedidos (Task 6).
3. Carrinho com produtos de **dois vendedores** → um pedido por vendedor, cada um com sua parcela de frete, e eventos para cada pedido (Task 4).
4. Opção habilitada mas usuário mantém "Cartão / Pix" → fluxo do MP inalterado, preferência criada normalmente (Task 6).
5. Rota de teste com MP totalmente fora (sem `MERCADOPAGO_ACCESS_TOKEN`) → continua funcionando (Task 4).

## File Structure

**Backend (`packages/medusa-backend/apps/backend/`)**
| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/utils/test-cash.ts` | criar | `isTestCashEnabled()`, constante do evento |
| `src/utils/validate-env.ts` | modificar | rejeitar flag ligada em produção |
| `src/utils/create-orders-from-checkout.ts` | criar | criação idempotente de pedidos a partir do snapshot |
| `src/utils/checkout-payload.ts` | criar | schema zod do checkout + montagem do snapshot |
| `src/api/webhooks/mercadopago/route.ts` | modificar | usar `createOrdersFromCheckout` |
| `src/api/store/checkout/preference/route.ts` | modificar | usar `checkout-payload` |
| `src/api/store/checkout/test-cash/route.ts` | criar | `GET`/`POST` |
| `src/subscribers/commission-on-payment.ts` | modificar | escutar `test_cash.order_approved` |
| `.env.template` | modificar | documentar flag |

**Infra/docs:** `infra/docker-compose.oci.yml`, `docs/DEPLOY_OCI.md`.

**Storefront (`apps/storefront/`)**
| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/lib/test-cash.ts` | criar | `fetchTestCashEnabled()` |
| `src/app/checkout/create-preference.ts` | modificar | exportar `buildCheckoutRequestBody` |
| `src/app/checkout/create-test-cash-order.ts` | criar | `createTestCashOrder()` |
| `src/components/payment/PaymentMethodSelector.tsx` | criar | rádios MP × dinheiro (teste) |
| `src/app/checkout/page.tsx` | modificar | descoberta + seletor + envio |
| `src/app/checkout/sucesso/ConfirmationContent.tsx` | modificar | ramo `?test_cash=` |

## Como rodar os testes

- Backend (um arquivo): `cd packages/medusa-backend/apps/backend && pnpm test:unit -- <caminho>`
- Backend (tudo): `cd packages/medusa-backend/apps/backend && pnpm test:unit`
- Storefront (um arquivo): `cd apps/storefront && pnpm vitest run <caminho>`
- Storefront (tudo): `cd apps/storefront && pnpm test`

Se `node_modules` não existir no worktree, rode `pnpm install` na raiz do worktree antes da Task 1.

---

### Task 1: Trava da flag + configuração

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/test-cash.ts`
- Create: `packages/medusa-backend/apps/backend/src/utils/__tests__/test-cash.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/src/utils/validate-env.ts`
- Modify: `packages/medusa-backend/apps/backend/src/utils/__tests__/validate-env.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/.env.template` (após `MARKETPLACE_SANDBOX=true`)
- Modify: `infra/docker-compose.oci.yml` (bloco `# MercadoPago` do serviço `medusa`)
- Modify: `docs/DEPLOY_OCI.md` (seção `## Observações`, no fim do arquivo)

**Interfaces:**
- Produces: `isTestCashEnabled(): boolean`; `TEST_CASH_ORDER_APPROVED_EVENT = "test_cash.order_approved"`; `TEST_CASH_PAYMENT_METHOD = "test_cash"`.

- [ ] **Step 1: Write the failing tests**

`src/utils/__tests__/test-cash.unit.spec.ts`:

```ts
import { isTestCashEnabled, TEST_CASH_ORDER_APPROVED_EVENT, TEST_CASH_PAYMENT_METHOD } from "../test-cash"

describe("isTestCashEnabled", () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  it("is disabled by default (flag unset)", () => {
    delete process.env.TEST_CASH_PAYMENT_ENABLED
    delete process.env.MARKETPLACE_SANDBOX
    expect(isTestCashEnabled()).toBe(false)
  })

  it("is enabled when flag is 'true' and sandbox mode is on", () => {
    process.env.TEST_CASH_PAYMENT_ENABLED = "true"
    delete process.env.MARKETPLACE_SANDBOX
    expect(isTestCashEnabled()).toBe(true)
  })

  it("is disabled when flag is 'true' but MARKETPLACE_SANDBOX=false (production)", () => {
    process.env.TEST_CASH_PAYMENT_ENABLED = "true"
    process.env.MARKETPLACE_SANDBOX = "false"
    expect(isTestCashEnabled()).toBe(false)
  })

  it.each(["TRUE", "1", " true", "yes", "false", ""])(
    "treats flag value %p as disabled (only the exact string 'true' enables it)",
    (value) => {
      process.env.TEST_CASH_PAYMENT_ENABLED = value
      delete process.env.MARKETPLACE_SANDBOX
      expect(isTestCashEnabled()).toBe(false)
    }
  )

  it("exposes the event name and payment method constants", () => {
    expect(TEST_CASH_ORDER_APPROVED_EVENT).toBe("test_cash.order_approved")
    expect(TEST_CASH_PAYMENT_METHOD).toBe("test_cash")
  })
})
```

Em `src/utils/__tests__/validate-env.unit.spec.ts`, dentro de `setBaseValidEnv()` adicione a linha `delete process.env.TEST_CASH_PAYMENT_ENABLED` (após `delete process.env.FOCUS_NFE_SANDBOX`) e acrescente este bloco ao final do `describe("validateEnv", ...)`:

```ts
  describe("test cash payment guard", () => {
    it("throws when TEST_CASH_PAYMENT_ENABLED=true and MARKETPLACE_SANDBOX=false", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.TEST_CASH_PAYMENT_ENABLED = "true"
      expect(() => validateEnv()).toThrow(/TEST_CASH_PAYMENT_ENABLED/)
    })

    it("passes when TEST_CASH_PAYMENT_ENABLED=true in sandbox mode", () => {
      setBaseValidEnv()
      process.env.TEST_CASH_PAYMENT_ENABLED = "true"
      expect(() => validateEnv()).not.toThrow()
    })

    it("passes in production mode when the flag is absent", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      expect(() => validateEnv()).not.toThrow()
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/utils/__tests__/test-cash.unit.spec.ts src/utils/__tests__/validate-env.unit.spec.ts`
Expected: FAIL — `Cannot find module '../test-cash'` e o teste "throws when TEST_CASH_PAYMENT_ENABLED=true..." falhando.

- [ ] **Step 3: Implement**

`src/utils/test-cash.ts`:

```ts
import { isSandboxMode } from "./sandbox"

export const TEST_CASH_PAYMENT_METHOD = "test_cash"

// Dedicated event so commission runs for test-cash orders while NF-e emission
// (which listens to mercadopago.order_approved) does not.
export const TEST_CASH_ORDER_APPROVED_EVENT = "test_cash.order_approved"

/**
 * Test-only payment that creates orders without charging anyone. Requires both
 * an explicit opt-in flag and sandbox mode: MARKETPLACE_SANDBOX defaults to
 * "true" in docker-compose.prod.yml, so sandbox mode alone is not a safe guard.
 */
export function isTestCashEnabled(): boolean {
  return process.env.TEST_CASH_PAYMENT_ENABLED === "true" && isSandboxMode()
}
```

Em `src/utils/validate-env.ts`, logo após `const sandbox = isSandboxMode()`:

```ts
  // Fail loudly on a contradictory config instead of silently ignoring the
  // flag: someone enabling test cash in production made a mistake worth seeing.
  if (process.env.TEST_CASH_PAYMENT_ENABLED === "true" && !sandbox) {
    throw new Error(
      "TEST_CASH_PAYMENT_ENABLED=true is not allowed when MARKETPLACE_SANDBOX=false (production mode). Remove TEST_CASH_PAYMENT_ENABLED."
    )
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/utils/__tests__/test-cash.unit.spec.ts src/utils/__tests__/validate-env.unit.spec.ts src/utils/__tests__/sandbox.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Configuração e documentação**

`.env.template`, logo após a linha `MARKETPLACE_SANDBOX=true`:

```
# -----------------------------------------------------------------------------
# Pagamento "Dinheiro (teste)" — SOMENTE AMBIENTES DE TESTE
# Cria pedidos sem cobrança, contornando o Mercado Pago. Só funciona com
# exatamente "true" E modo sandbox. Com MARKETPLACE_SANDBOX=false o backend
# recusa subir se esta flag estiver "true". Nunca declarar em produção.
# -----------------------------------------------------------------------------
TEST_CASH_PAYMENT_ENABLED=false
```

`infra/docker-compose.oci.yml`, no serviço `medusa`, logo após `MERCADOPAGO_WEBHOOK_SECRET: ${MERCADOPAGO_WEBHOOK_SECRET}`:

```yaml

      # Pagamento "Dinheiro (teste)" — só ambientes de teste (ver .env.template)
      TEST_CASH_PAYMENT_ENABLED: ${TEST_CASH_PAYMENT_ENABLED:-false}
```

`docs/DEPLOY_OCI.md`, novo item ao final da lista de `## Observações`:

```markdown
- **Pagamento "Dinheiro (teste)"**: para percorrer o checkout sem o Mercado Pago, defina `TEST_CASH_PAYMENT_ENABLED=true` no `.env` do servidor de testes e recrie o container `medusa`. A opção aparece na etapa de entrega do checkout. Nunca declarar essa variável em `docker-compose.prod.yml` — com `MARKETPLACE_SANDBOX=false` o backend recusa subir.
```

Confirme que `infra/docker-compose.prod.yml` **não** contém `TEST_CASH`: `grep -c TEST_CASH infra/docker-compose.prod.yml` → `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/test-cash.ts \
  packages/medusa-backend/apps/backend/src/utils/__tests__/test-cash.unit.spec.ts \
  packages/medusa-backend/apps/backend/src/utils/validate-env.ts \
  packages/medusa-backend/apps/backend/src/utils/__tests__/validate-env.unit.spec.ts \
  packages/medusa-backend/apps/backend/.env.template infra/docker-compose.oci.yml docs/DEPLOY_OCI.md
git commit -m "feat(checkout): adicionar trava de ambiente para pagamento em dinheiro de teste" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm"
```

---

### Task 2: Extrair `createOrdersFromCheckout` do webhook do MP

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/create-orders-from-checkout.ts`
- Create: `packages/medusa-backend/apps/backend/src/utils/__tests__/create-orders-from-checkout.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts` (bloco de `const addr = meta?.address` até o `logger.info` de pedidos criados)
- Test (regressão, sem alteração): `src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `SellerGroup` de `src/utils/seller-order-groups.ts`.
- Produces:
  ```ts
  type CheckoutMeta = {
    seller_groups?: SellerGroup[]
    seller_id?: string
    items?: SellerGroup["items"]
    shipping?: { id?: string; name: string; price: number }
    address?: Record<string, string>
    buyer_document?: string
  }
  createOrdersFromCheckout(args: {
    container: { resolve: (key: string) => any }
    externalReference: string
    meta: CheckoutMeta
    extraMetadata?: Record<string, unknown>
    fallbackPayer?: Record<string, any>
  }): Promise<Array<{ id: string }>>  // only newly created orders; [] when all already exist
  ```

- [ ] **Step 1: Write the failing test**

`src/utils/__tests__/create-orders-from-checkout.unit.spec.ts`:

```ts
import { Modules } from "@medusajs/framework/utils"
import { createOrdersFromCheckout, type CheckoutMeta } from "../create-orders-from-checkout"

function makeContainer(existingBySeller: Record<string, boolean> = {}) {
  const orderService = {
    listOrders: jest.fn(async (filter: any) =>
      existingBySeller[filter.metadata.seller_id] ? [{ id: "existing" }] : []
    ),
    createOrders: jest.fn(async (input: any[]) => input.map((_, i) => ({ id: `order-${i + 1}` }))),
  }
  return {
    resolve: (key: string) => {
      if (key === Modules.ORDER) return orderService
      throw new Error(`Unexpected resolve: ${key}`)
    },
    _orderService: orderService,
  }
}

const address = {
  first_name: "João",
  last_name: "Silva",
  email: "joao@email.com",
  phone: "71999990000",
  address_1: "Rua das Flores",
  address_2: "100",
  city: "Cachoeira",
  state: "BA",
  postal_code: "44300000",
}

const twoSellerMeta: CheckoutMeta = {
  address,
  buyer_document: "11144477735",
  shipping: { id: "pac", name: "PAC", price: 2500 },
  seller_groups: [
    { sellerId: "seller-a", subtotal: 7900, shippingShare: 1500, items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }] },
    { sellerId: "seller-b", subtotal: 5000, shippingShare: 1000, items: [{ variant_id: "var-2", title: "Boné", quantity: 1, price: 5000 }] },
  ],
}

describe("createOrdersFromCheckout", () => {
  it("creates one order per seller group with its own shipping share", async () => {
    const container = makeContainer()

    const created = await createOrdersFromCheckout({ container, externalReference: "ref-1", meta: twoSellerMeta })

    expect(created).toEqual([{ id: "order-1" }, { id: "order-2" }])
    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input).toHaveLength(2)
    expect(input[0].shipping_methods).toEqual([{ name: "PAC", amount: 1500 }])
    expect(input[1].shipping_methods).toEqual([{ name: "PAC", amount: 1000 }])
    expect(input[0].items).toEqual([{ title: "Camiseta", quantity: 1, unit_price: 7900, variant_id: "var-1" }])
    expect(input[0].email).toBe("joao@email.com")
    expect(input[0].shipping_address).toEqual(
      expect.objectContaining({ first_name: "João", postal_code: "44300000", province: "BA", country_code: "br" })
    )
  })

  it("stores the checkout reference, seller and buyer document in metadata, merged with extraMetadata", async () => {
    const container = makeContainer()

    await createOrdersFromCheckout({
      container,
      externalReference: "ref-1",
      meta: twoSellerMeta,
      extraMetadata: { payment_method: "test_cash" },
    })

    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input[0].metadata).toEqual({
      mercadopago_external_reference: "ref-1",
      seller_id: "seller-a",
      buyer_document: "11144477735",
      payment_method: "test_cash",
    })
  })

  it("only creates orders for seller groups that do not exist yet (idempotency)", async () => {
    const container = makeContainer({ "seller-a": true })

    const created = await createOrdersFromCheckout({ container, externalReference: "ref-1", meta: twoSellerMeta })

    expect(created).toHaveLength(1)
    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input.map((o: any) => o.metadata.seller_id)).toEqual(["seller-b"])
  })

  it("returns [] without calling createOrders when every group already exists", async () => {
    const container = makeContainer({ "seller-a": true, "seller-b": true })

    const created = await createOrdersFromCheckout({ container, externalReference: "ref-1", meta: twoSellerMeta })

    expect(created).toEqual([])
    expect(container._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("falls back to a single group from seller_id/items/shipping when seller_groups is absent", async () => {
    const container = makeContainer()

    await createOrdersFromCheckout({
      container,
      externalReference: "ref-1",
      meta: {
        address,
        seller_id: "seller-legacy",
        items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }],
        shipping: { name: "PAC", price: 1500 },
      },
    })

    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input).toHaveLength(1)
    expect(input[0].metadata.seller_id).toBe("seller-legacy")
    expect(input[0].shipping_methods).toEqual([{ name: "PAC", amount: 1500 }])
  })

  it("uses fallbackPayer fields when the snapshot address is missing", async () => {
    const container = makeContainer()

    await createOrdersFromCheckout({
      container,
      externalReference: "ref-1",
      meta: { seller_id: "s", items: [{ title: "X", quantity: 1, price: 100 }] },
      fallbackPayer: { email: "payer@mp.com", name: "Ana", surname: "Souza", phone: { number: "7188" }, address: { street_name: "Rua MP", zip_code: "40000000" } },
    })

    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input[0].email).toBe("payer@mp.com")
    expect(input[0].shipping_address).toEqual(
      expect.objectContaining({ first_name: "Ana", last_name: "Souza", phone: "7188", address_1: "Rua MP", postal_code: "40000000" })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/utils/__tests__/create-orders-from-checkout.unit.spec.ts`
Expected: FAIL — `Cannot find module '../create-orders-from-checkout'`.

- [ ] **Step 3: Implement**

`src/utils/create-orders-from-checkout.ts`:

```ts
import { Modules } from "@medusajs/framework/utils"
import type { SellerGroup } from "./seller-order-groups"

export type CheckoutMeta = {
  seller_groups?: SellerGroup[]
  seller_id?: string
  items?: SellerGroup["items"]
  shipping?: { id?: string; name: string; price: number }
  address?: Record<string, string>
  buyer_document?: string
}

type CreateOrdersFromCheckoutArgs = {
  container: { resolve: (key: string) => any }
  externalReference: string
  meta: CheckoutMeta
  extraMetadata?: Record<string, unknown>
  // MercadoPago payer data, used by the webhook only when the snapshot lacks an address.
  fallbackPayer?: Record<string, any>
}

/**
 * Creates one order per seller group of a checkout. Idempotent per
 * (externalReference, seller): groups that already have an order are skipped,
 * so retried webhooks never duplicate orders. Callers emit the events, since
 * which events fire depends on how the checkout was paid.
 */
export async function createOrdersFromCheckout({
  container,
  externalReference,
  meta,
  extraMetadata = {},
  fallbackPayer,
}: CreateOrdersFromCheckoutArgs): Promise<Array<{ id: string }>> {
  const addr = meta.address
  const shipping = meta.shipping

  const sellerGroups: SellerGroup[] = Array.isArray(meta.seller_groups)
    ? meta.seller_groups
    : [
        {
          sellerId: meta.seller_id,
          subtotal: 0,
          shippingShare: shipping?.price ?? 0,
          items: meta.items ?? [],
        } as SellerGroup,
      ]

  const orderService = container.resolve(Modules.ORDER)

  const pendingGroups: SellerGroup[] = []
  for (const group of sellerGroups) {
    const existing = await orderService.listOrders(
      { metadata: { mercadopago_external_reference: externalReference, seller_id: group.sellerId } } as any,
      { take: 1 }
    )
    if (existing.length === 0) pendingGroups.push(group)
  }

  if (pendingGroups.length === 0) return []

  return orderService.createOrders(
    pendingGroups.map((group) => ({
      currency_code: "brl",
      email: addr?.email ?? fallbackPayer?.email,
      shipping_address: {
        first_name: addr?.first_name ?? fallbackPayer?.name ?? "",
        last_name: addr?.last_name ?? fallbackPayer?.surname ?? "",
        phone: addr?.phone ?? fallbackPayer?.phone?.number ?? "",
        address_1: addr?.address_1 ?? fallbackPayer?.address?.street_name ?? "",
        address_2: addr?.address_2 ?? "",
        city: addr?.city ?? "",
        province: addr?.state ?? "",
        country_code: "br",
        postal_code: addr?.postal_code ?? fallbackPayer?.address?.zip_code ?? "",
      },
      items: group.items.map((i) => ({
        title: i.title,
        quantity: i.quantity,
        unit_price: i.price,
        ...(i.variant_id ? { variant_id: i.variant_id } : {}),
      })),
      shipping_methods: shipping ? [{ name: shipping.name, amount: group.shippingShare }] : [],
      metadata: {
        mercadopago_external_reference: externalReference,
        seller_id: group.sellerId,
        buyer_document: meta.buyer_document,
        ...extraMetadata,
      },
    }))
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/utils/__tests__/create-orders-from-checkout.unit.spec.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Refatorar o webhook para usar a função**

Em `src/api/webhooks/mercadopago/route.ts`:

1. Remova o import que fica sem uso (`import type { SellerGroup } ...`) — **mantenha** `Modules`, ainda usado para `Modules.EVENT_BUS` — e adicione:
   ```ts
   import { createOrdersFromCheckout } from "../../../utils/create-orders-from-checkout"
   ```
2. Substitua todo o trecho que começa em `const addr = meta?.address as Record<string, string> | undefined` e termina no `logger.info(... pedido(s) criado(s) para ref ...)` por:

```ts
      if (!meta?.items?.length) {
        logger.error(
          `[mercadopago/webhook] metadados do checkout não recuperados (payment.metadata vazio, snapshot ausente, busca de preferência sem resultado) — pedido NÃO criado pra ref ${payment.external_reference}, payment ${payment.id}`
        )
        return res.sendStatus(200)
      }

      const createdOrders = await createOrdersFromCheckout({
        container: req.scope,
        externalReference: payment.external_reference as string,
        meta,
        extraMetadata: { mercadopago_payment_id: String(payment.id) },
        fallbackPayer: payment.payer as Record<string, any> | undefined,
      })

      if (createdOrders.length === 0) {
        logger.info(
          `[mercadopago/webhook] todos os pedidos já existem para ref ${payment.external_reference} — ignorando webhook duplicado`
        )
        return res.sendStatus(200)
      }

      logger.info(
        `[mercadopago/webhook] ${createdOrders.length} pedido(s) criado(s) para ref ${payment.external_reference}`
      )

      const eventBusService = req.scope.resolve(Modules.EVENT_BUS)
```

   Isso também remove as declarações antigas de `orderService`, `eventBusService`, `sellerGroups` e `pendingGroups` do webhook (agora vivem na função ou foram redeclaradas acima). O bloco seguinte (comentário + `await eventBusService.emit(...)`) permanece igual.

- [ ] **Step 6: Run webhook regression tests**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/api/webhooks/mercadopago`
Expected: PASS em todos os testes existentes (incluindo "only creates orders for seller groups that don't already exist", "skips order creation entirely..." e "emits order.placed and mercadopago.order_approved once per created order"). Se algum falhar, a refatoração mudou comportamento — corrija a refatoração, não o teste.

Também rode: `cd packages/medusa-backend/apps/backend && npx tsc --noEmit -p .` — Expected: nenhum erro novo nos arquivos tocados.

- [ ] **Step 7: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/create-orders-from-checkout.ts \
  packages/medusa-backend/apps/backend/src/utils/__tests__/create-orders-from-checkout.unit.spec.ts \
  packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts
git commit -m "refactor(checkout): extrair criação de pedidos do webhook do mercado pago" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm"
```

---

### Task 3: Extrair schema e snapshot do checkout da rota de preference

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/checkout-payload.ts`
- Create: `packages/medusa-backend/apps/backend/src/utils/__tests__/checkout-payload.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`
- Test (regressão, sem alteração): `src/api/store/checkout/preference/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `validateDocument` (`src/utils/validate-document.ts`), `groupItemsBySeller` / `SellerGroup` (`src/utils/seller-order-groups.ts`), `CheckoutMeta` (Task 2).
- Produces:
  ```ts
  checkoutRequestSchema: z.ZodObject<...>
  type CheckoutRequest = z.infer<typeof checkoutRequestSchema>
  type CheckoutSnapshotPayload = CheckoutMeta & {
    seller_groups: SellerGroup[]; buyer_document: string; address: Record<string, string>;
    items: SellerGroup["items"]; shipping: { id: string; name: string; price: number }; total: number
  }
  buildCheckoutSnapshot(query: { graph: (args: any) => Promise<{ data: any[] }> }, request: CheckoutRequest):
    Promise<{ payload: CheckoutSnapshotPayload } | { unresolvedProductId: string }>
  ```

- [ ] **Step 1: Write the failing test**

`src/utils/__tests__/checkout-payload.unit.spec.ts`:

```ts
import { buildCheckoutSnapshot, checkoutRequestSchema, type CheckoutRequest } from "../checkout-payload"

const request: CheckoutRequest = {
  items: [
    { title: "Camiseta", quantity: 2, price: 7900, variantId: "var-1", productId: "prod-1" },
    { title: "Boné", quantity: 1, price: 5000, variantId: "var-2", productId: "prod-2" },
  ],
  address: {
    firstName: "João",
    lastName: "Silva",
    email: "joao@email.com",
    phone: "71999990000",
    cep: "44300-000",
    address1: "Rua das Flores",
    address2: "100",
    city: "Cachoeira",
    state: "BA",
  },
  shipping: { id: "pac", name: "PAC", price: 2500 },
  total: 23300,
  document: "111.444.777-35",
}

function makeQuery(sellers: Record<string, string>) {
  return {
    graph: jest.fn().mockResolvedValue({
      data: Object.entries(sellers).map(([id, sellerId]) => ({ id, seller: { id: sellerId } })),
    }),
  }
}

describe("checkoutRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(checkoutRequestSchema.safeParse(request).success).toBe(true)
  })

  it("rejects an empty items array", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, items: [] }).success).toBe(false)
  })

  it("rejects an invalid CPF/CNPJ", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, document: "123" }).success).toBe(false)
  })
})

describe("buildCheckoutSnapshot", () => {
  it("builds the snapshot payload with seller groups, digits-only document and CEP", async () => {
    const query = makeQuery({ "prod-1": "seller-a", "prod-2": "seller-b" })

    const result = await buildCheckoutSnapshot(query, request)

    expect(query.graph).toHaveBeenCalledWith({
      entity: "product",
      fields: ["id", "seller.id"],
      filters: { id: ["prod-1", "prod-2"] },
    })
    if (!("payload" in result)) throw new Error("expected payload")
    expect(result.payload.buyer_document).toBe("11144477735")
    expect(result.payload.address.postal_code).toBe("44300000")
    expect(result.payload.seller_groups.map((g) => g.sellerId)).toEqual(["seller-a", "seller-b"])
    expect(result.payload.items).toEqual([
      { variant_id: "var-1", title: "Camiseta", quantity: 2, price: 7900 },
      { variant_id: "var-2", title: "Boné", quantity: 1, price: 5000 },
    ])
    expect(result.payload.shipping).toEqual({ id: "pac", name: "PAC", price: 2500 })
    expect(result.payload.total).toBe(23300)
  })

  it("returns unresolvedProductId when a product has no seller", async () => {
    const query = makeQuery({ "prod-1": "seller-a" })

    const result = await buildCheckoutSnapshot(query, request)

    expect(result).toEqual({ unresolvedProductId: "prod-2" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/utils/__tests__/checkout-payload.unit.spec.ts`
Expected: FAIL — `Cannot find module '../checkout-payload'`.

- [ ] **Step 3: Implement**

`src/utils/checkout-payload.ts` (o schema é movido **literalmente** da rota de preference):

```ts
import { z } from "zod"
import { validateDocument } from "./validate-document"
import { groupItemsBySeller, type SellerGroup } from "./seller-order-groups"
import type { CheckoutMeta } from "./create-orders-from-checkout"

// Shared by every checkout entry point (MercadoPago preference, test cash) so
// they validate and persist exactly the same shape.
export const checkoutRequestSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      quantity: z.number().int().positive(),
      price: z.number().int().positive(),
      variantId: z.string().optional(),
      productId: z.string(),
    })
  ).min(1),
  address: z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email(),
    phone: z.string().optional(),
    cep: z.string(),
    address1: z.string(),
    address2: z.string().optional(),
    city: z.string(),
    state: z.string(),
  }),
  shipping: z.object({
    id: z.string(),
    name: z.string(),
    price: z.number().int().nonnegative(),
  }),
  total: z.number().int().positive(),
  document: z.string().refine((v) => validateDocument(v).valid, {
    message: "CPF ou CNPJ inválido",
  }),
})

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export type CheckoutSnapshotPayload = CheckoutMeta & {
  seller_groups: SellerGroup[]
  buyer_document: string
  address: Record<string, string>
  items: SellerGroup["items"]
  shipping: { id: string; name: string; price: number }
  total: number
}

type ProductQuery = { graph: (args: any) => Promise<{ data: any[] }> }

export async function buildCheckoutSnapshot(
  query: ProductQuery,
  request: CheckoutRequest
): Promise<{ payload: CheckoutSnapshotPayload } | { unresolvedProductId: string }> {
  const { items, address, shipping, total, document } = request
  const { digits: buyerDocument } = validateDocument(document)

  const productIds = [...new Set(items.map((i) => i.productId))]
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "seller.id"],
    filters: { id: productIds },
  })
  const sellerByProductId: Record<string, string> = {}
  for (const p of products as any[]) {
    if (p.seller?.id) sellerByProductId[p.id] = p.seller.id
  }

  const grouped = groupItemsBySeller(items, sellerByProductId, shipping.price)
  if ("unresolvedProductId" in grouped) {
    return { unresolvedProductId: grouped.unresolvedProductId }
  }

  return {
    payload: {
      seller_groups: grouped.groups,
      buyer_document: buyerDocument,
      address: {
        first_name: address.firstName,
        last_name: address.lastName,
        email: address.email,
        phone: address.phone ?? "",
        address_1: address.address1,
        address_2: address.address2 ?? "",
        city: address.city,
        state: address.state,
        postal_code: address.cep.replace(/\D/g, ""),
      },
      items: items.map((i) => ({
        variant_id: i.variantId,
        title: i.title,
        quantity: i.quantity,
        price: i.price,
      })),
      shipping: { id: shipping.id, name: shipping.name, price: shipping.price },
      total,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/utils/__tests__/checkout-payload.unit.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Refatorar a rota de preference**

Em `src/api/store/checkout/preference/route.ts`:

1. Remova os imports `z`, `validateDocument` e `groupItemsBySeller`, e o `const schema = z.object({...})` inteiro. Adicione:
   ```ts
   import { buildCheckoutSnapshot, checkoutRequestSchema } from "../../../../utils/checkout-payload"
   ```
2. Troque `const parsed = schema.safeParse(req.body)` por `const parsed = checkoutRequestSchema.safeParse(req.body)`.
3. Substitua o trecho desde `const { items, address, shipping, total, document } = parsed.data` até o fim da declaração `const checkoutSnapshotPayload = {...}` (inclusive) por:

```ts
  const { items, address, shipping } = parsed.data
  const storeCors = process.env.STORE_CORS?.split(",")[0] ?? "http://localhost:3000"
  const backendUrl = process.env.BACKEND_URL

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const built = await buildCheckoutSnapshot(query, parsed.data)
  if ("unresolvedProductId" in built) {
    return res.status(400).json({
      error: "Produto sem vendedor associado.",
      productId: built.unresolvedProductId,
    })
  }
  const checkoutSnapshotPayload = built.payload

  const externalReference = crypto.randomUUID()
```

O restante da rota (gravação do snapshot, `preference.create`, `attachPreferenceId`, resposta) fica idêntico.

- [ ] **Step 6: Run preference regression tests + typecheck**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/api/store/checkout/preference && npx tsc --noEmit -p .`
Expected: PASS em todos os testes existentes da preference; nenhum erro de tipo novo.

- [ ] **Step 7: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/checkout-payload.ts \
  packages/medusa-backend/apps/backend/src/utils/__tests__/checkout-payload.unit.spec.ts \
  packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts
git commit -m "refactor(checkout): extrair schema e snapshot do checkout para módulo compartilhado" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm"
```

---

### Task 4: Rota `/store/checkout/test-cash` + subscriber de comissão

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/store/checkout/test-cash/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/store/checkout/test-cash/__tests__/route.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts` (`export const config`)
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/commission-on-payment-config.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-fiscal-emit-config.unit.spec.ts`

**Interfaces:**
- Consumes: `isTestCashEnabled`, `TEST_CASH_ORDER_APPROVED_EVENT`, `TEST_CASH_PAYMENT_METHOD` (Task 1); `createOrdersFromCheckout` (Task 2); `checkoutRequestSchema`, `buildCheckoutSnapshot` (Task 3); `CHECKOUT_MODULE` + `CheckoutModuleService.recordSnapshot(ref, payload)`.
- Produces (HTTP):
  - `GET /store/checkout/test-cash` → `200 { enabled: boolean }`
  - `POST /store/checkout/test-cash` (mesmo corpo da preference) → `200 { external_reference: string }` | `400 { error, details? | productId? }` | `404 { message: "Not Found" }` | `500 { error, detail }`

- [ ] **Step 1: Write the failing tests**

`src/api/store/checkout/test-cash/__tests__/route.unit.spec.ts`:

```ts
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CHECKOUT_MODULE } from "../../../../../modules/checkout"

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto")
  return { ...actual, randomUUID: () => "fixed-uuid-1234" }
})

import { GET, POST } from "../route"

const validBody = {
  items: [
    { title: "Camiseta", quantity: 1, price: 7900, variantId: "var-1", productId: "prod-1" },
    { title: "Boné", quantity: 1, price: 5000, variantId: "var-2", productId: "prod-2" },
  ],
  address: {
    firstName: "João",
    lastName: "Silva",
    email: "joao@email.com",
    phone: "71999990000",
    cep: "44300-000",
    address1: "Rua das Flores",
    address2: "100",
    city: "Cachoeira",
    state: "BA",
  },
  shipping: { id: "pac", name: "PAC", price: 2500 },
  total: 15400,
  document: "111.444.777-35",
}

function makeReq(body: unknown = validBody, overrides: { recordSnapshot?: jest.Mock; createOrders?: jest.Mock } = {}) {
  const graph = jest.fn().mockResolvedValue({
    data: [
      { id: "prod-1", seller: { id: "seller-a" } },
      { id: "prod-2", seller: { id: "seller-b" } },
    ],
  })
  const checkoutService = { recordSnapshot: overrides.recordSnapshot ?? jest.fn().mockResolvedValue(undefined) }
  const orderService = {
    listOrders: jest.fn().mockResolvedValue([]),
    createOrders: overrides.createOrders ?? jest.fn(async (input: any[]) => input.map((_, i) => ({ id: `order-${i + 1}` }))),
  }
  const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        if (key === CHECKOUT_MODULE) return checkoutService
        if (key === Modules.ORDER) return orderService
        if (key === Modules.EVENT_BUS) return eventBus
        if (key === "logger") return logger
        throw new Error(`Unexpected resolve: ${key}`)
      },
    },
    _checkoutService: checkoutService,
    _orderService: orderService,
    _eventBus: eventBus,
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("/store/checkout/test-cash", () => {
  const original = { ...process.env }

  beforeEach(() => {
    process.env = { ...original }
    delete process.env.MARKETPLACE_SANDBOX
    // The route must work with MercadoPago completely unavailable.
    delete process.env.MERCADOPAGO_ACCESS_TOKEN
    process.env.TEST_CASH_PAYMENT_ENABLED = "true"
  })

  afterAll(() => {
    process.env = original
  })

  describe("GET", () => {
    it("reports enabled: true when the guard is on", async () => {
      const res = makeRes()
      await GET(makeReq(), res)
      expect(res._body).toEqual({ enabled: true })
    })

    it("reports enabled: false when the flag is absent", async () => {
      delete process.env.TEST_CASH_PAYMENT_ENABLED
      const res = makeRes()
      await GET(makeReq(), res)
      expect(res._body).toEqual({ enabled: false })
    })

    it("reports enabled: false in production mode even with the flag set", async () => {
      process.env.MARKETPLACE_SANDBOX = "false"
      const res = makeRes()
      await GET(makeReq(), res)
      expect(res._body).toEqual({ enabled: false })
    })
  })

  describe("POST", () => {
    it("returns 404 and creates nothing when the guard is off", async () => {
      delete process.env.TEST_CASH_PAYMENT_ENABLED
      const req = makeReq()
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(404)
      expect(req._checkoutService.recordSnapshot).not.toHaveBeenCalled()
      expect(req._orderService.createOrders).not.toHaveBeenCalled()
    })

    it("returns 404 in production mode even with the flag set", async () => {
      process.env.MARKETPLACE_SANDBOX = "false"
      const res = makeRes()
      await POST(makeReq(), res)
      expect(res._status).toBe(404)
    })

    it("returns 400 for an invalid payload", async () => {
      const req = makeReq({ ...validBody, items: [] })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(400)
      expect(req._orderService.createOrders).not.toHaveBeenCalled()
    })

    it("returns 400 when a product has no seller", async () => {
      const req = makeReq({ ...validBody, items: [{ ...validBody.items[0], productId: "prod-orphan" }] })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(400)
      expect(res._body).toEqual({ error: "Produto sem vendedor associado.", productId: "prod-orphan" })
    })

    it("records the snapshot and creates one test_cash order per seller, without MercadoPago credentials", async () => {
      const req = makeReq()
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(200)
      expect(res._body).toEqual({ external_reference: "fixed-uuid-1234" })
      expect(req._checkoutService.recordSnapshot).toHaveBeenCalledWith(
        "fixed-uuid-1234",
        expect.objectContaining({ buyer_document: "11144477735", total: 15400 })
      )
      const input = req._orderService.createOrders.mock.calls[0][0]
      expect(input.map((o: any) => o.metadata.seller_id)).toEqual(["seller-a", "seller-b"])
      for (const order of input) {
        expect(order.metadata).toEqual(
          expect.objectContaining({ payment_method: "test_cash", mercadopago_external_reference: "fixed-uuid-1234" })
        )
        expect(order.metadata).not.toHaveProperty("mercadopago_payment_id")
      }
      // Shipping split across both sellers sums to the full price.
      const shippingTotal = input.reduce((sum: number, o: any) => sum + o.shipping_methods[0].amount, 0)
      expect(shippingTotal).toBe(2500)
    })

    it("emits order.placed and test_cash.order_approved per order, never mercadopago.order_approved", async () => {
      const req = makeReq()
      await POST(req, makeRes())

      expect(req._eventBus.emit).toHaveBeenCalledWith([
        { name: "order.placed", data: { id: "order-1" } },
        { name: "test_cash.order_approved", data: { id: "order-1" } },
        { name: "order.placed", data: { id: "order-2" } },
        { name: "test_cash.order_approved", data: { id: "order-2" } },
      ])
      const names = req._eventBus.emit.mock.calls.flatMap((c: any[]) => c[0].map((e: any) => e.name))
      expect(names).not.toContain("mercadopago.order_approved")
    })

    it("returns 500 and emits nothing when the snapshot cannot be recorded", async () => {
      const req = makeReq(validBody, { recordSnapshot: jest.fn().mockRejectedValue(new Error("db down")) })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(500)
      expect(req._orderService.createOrders).not.toHaveBeenCalled()
      expect(req._eventBus.emit).not.toHaveBeenCalled()
    })

    it("returns 500 and emits nothing when order creation fails", async () => {
      const req = makeReq(validBody, { createOrders: jest.fn().mockRejectedValue(new Error("boom")) })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(500)
      expect(req._eventBus.emit).not.toHaveBeenCalled()
    })
  })
})
```

Em `src/subscribers/__tests__/commission-on-payment-config.unit.spec.ts`, adicione ao `describe`:

```ts
  it("also subscribes to test_cash.order_approved so test-cash orders get commission", () => {
    expect(config.event).toEqual(expect.arrayContaining(["test_cash.order_approved"]))
  })
```

Em `src/subscribers/__tests__/order-fiscal-emit-config.unit.spec.ts`, adicione ao `describe`:

```ts
  it("does not subscribe to test_cash.order_approved (test-cash orders must never emit NF-e)", () => {
    expect(config.event).not.toEqual(expect.arrayContaining(["test_cash.order_approved"]))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/api/store/checkout/test-cash src/subscribers/__tests__/commission-on-payment-config.unit.spec.ts src/subscribers/__tests__/order-fiscal-emit-config.unit.spec.ts`
Expected: FAIL — `Cannot find module '../route'` e o teste de comissão falhando; o teste de NF-e já passa (guarda contra regressão).

- [ ] **Step 3: Implement the route**

`src/api/store/checkout/test-cash/route.ts`:

```ts
import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  isTestCashEnabled,
  TEST_CASH_ORDER_APPROVED_EVENT,
  TEST_CASH_PAYMENT_METHOD,
} from "../../../../utils/test-cash"
import { buildCheckoutSnapshot, checkoutRequestSchema } from "../../../../utils/checkout-payload"
import { createOrdersFromCheckout } from "../../../../utils/create-orders-from-checkout"
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"

// Lets the storefront decide at runtime whether to offer the option, so no
// build-time flag can leak it into a production image.
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.json({ enabled: isTestCashEnabled() })
}

/**
 * Test-only checkout: creates the orders immediately, as if paid in cash,
 * without touching MercadoPago. Exists to keep end-to-end testing possible
 * while MercadoPago test credentials are unstable.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Indistinguishable from a missing route when disabled.
  if (!isTestCashEnabled()) {
    return res.status(404).json({ message: "Not Found" })
  }

  const parsed = checkoutRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const built = await buildCheckoutSnapshot(query, parsed.data)
  if ("unresolvedProductId" in built) {
    return res.status(400).json({
      error: "Produto sem vendedor associado.",
      productId: built.unresolvedProductId,
    })
  }

  const logger = req.scope.resolve("logger")
  const externalReference = crypto.randomUUID()

  try {
    const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)
    await checkoutService.recordSnapshot(externalReference, built.payload)

    const createdOrders = await createOrdersFromCheckout({
      container: req.scope,
      externalReference,
      meta: built.payload,
      extraMetadata: { payment_method: TEST_CASH_PAYMENT_METHOD },
    })

    const eventBusService = req.scope.resolve(Modules.EVENT_BUS)
    await eventBusService.emit(
      createdOrders.flatMap((order) => [
        { name: "order.placed", data: { id: order.id } },
        { name: TEST_CASH_ORDER_APPROVED_EVENT, data: { id: order.id } },
      ])
    )

    logger.info(
      `[checkout/test-cash] ${createdOrders.length} pedido(s) de teste criado(s) para ref ${externalReference}`
    )
    res.json({ external_reference: externalReference })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    logger.error(`[checkout/test-cash] falha ao criar pedido de teste: ${msg}`)
    res.status(500).json({ error: "Erro ao criar pedido de teste.", detail: msg })
  }
}
```

- [ ] **Step 4: Update the commission subscriber**

Em `src/subscribers/commission-on-payment.ts`, adicione o import:

```ts
import { TEST_CASH_ORDER_APPROVED_EVENT } from "../utils/test-cash"
```

e troque a linha `event: ["mercadopago.order_approved", "marketplace.order_placed"],` por:

```ts
  // Test-cash orders (test environments only) also earn commission, but use a
  // separate event so order-fiscal-emit never issues an NF-e for them.
  event: ["mercadopago.order_approved", "marketplace.order_placed", TEST_CASH_ORDER_APPROVED_EVENT],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit -- src/api/store/checkout/test-cash src/subscribers/__tests__/commission-on-payment-config.unit.spec.ts src/subscribers/__tests__/order-fiscal-emit-config.unit.spec.ts`
Expected: PASS.

- [ ] **Step 6: Full backend suite + typecheck**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit && npx tsc --noEmit -p .`
Expected: todas as suítes verdes; nenhum erro de tipo novo.

- [ ] **Step 7: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/checkout/test-cash \
  packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts \
  packages/medusa-backend/apps/backend/src/subscribers/__tests__/commission-on-payment-config.unit.spec.ts \
  packages/medusa-backend/apps/backend/src/subscribers/__tests__/order-fiscal-emit-config.unit.spec.ts
git commit -m "feat(checkout): adicionar rota de pagamento em dinheiro de teste" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm"
```

---

### Task 5: Clientes do storefront (`fetchTestCashEnabled`, `createTestCashOrder`)

**Files:**
- Create: `apps/storefront/src/lib/test-cash.ts`
- Create: `apps/storefront/src/lib/__tests__/test-cash.test.ts`
- Modify: `apps/storefront/src/app/checkout/create-preference.ts`
- Create: `apps/storefront/src/app/checkout/create-test-cash-order.ts`
- Create: `apps/storefront/src/app/checkout/__tests__/create-test-cash-order.test.ts`
- Test (regressão): `apps/storefront/src/app/checkout/__tests__/page.test.ts`

**Interfaces:**
- Consumes: HTTP de Task 4.
- Produces:
  ```ts
  // src/lib/test-cash.ts
  fetchTestCashEnabled(): Promise<boolean>
  // src/app/checkout/create-preference.ts
  type CheckoutItem = { title: string; quantity: number; price: number; variantId?: string; productId: string }
  buildCheckoutRequestBody(items: CheckoutItem[], address: Address, shipping: ShippingRate): {
    items: CheckoutItem[]; address: Address; shipping: ShippingRate; total: number; document: string
  }
  // src/app/checkout/create-test-cash-order.ts
  createTestCashOrder(items: CheckoutItem[], address: Address, shipping: ShippingRate):
    Promise<{ externalReference: string } | null>
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/test-cash.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTestCashEnabled } from '../test-cash'

describe('fetchTestCashEnabled', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when the backend reports enabled: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchTestCashEnabled()).toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/store\/checkout\/test-cash$/)
  })

  it('returns false when the backend reports enabled: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ enabled: true }) }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false when the body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad json') } }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })

  it('returns false for a truthy but non-boolean value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: 'true' }) }))
    expect(await fetchTestCashEnabled()).toBe(false)
  })
})
```

`src/app/checkout/__tests__/create-test-cash-order.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestCashOrder } from '../create-test-cash-order'

const items = [{ title: 'Camiseta', quantity: 2, price: 7900, variantId: 'var-1', productId: 'prod-1' }]
const address = {
  firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
  document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
  city: 'Cachoeira', state: 'BA',
}
const shipping = { id: 'pac', name: 'PAC', company: 'Correios', price: 2500, currency: 'brl', delivery_time: '5 dias' }

describe('createTestCashOrder', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the same body as the preference request and returns the external reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external_reference: 'ref-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createTestCashOrder(items, address, shipping)

    expect(result).toEqual({ externalReference: 'ref-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/store\/checkout\/test-cash$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ items, address, shipping, total: 2 * 7900 + 2500, document: '111.444.777-35' })
  })

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }))
    expect(await createTestCashOrder(items, address, shipping)).toBeNull()
  })

  it('returns null when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await createTestCashOrder(items, address, shipping)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && pnpm vitest run src/lib/__tests__/test-cash.test.ts src/app/checkout/__tests__/create-test-cash-order.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implement**

`src/lib/test-cash.ts`:

```ts
const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

/**
 * Asks the backend whether the test-only cash payment is enabled. Any failure
 * means "no": the option must never show up by accident.
 */
export async function fetchTestCashEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${MEDUSA_URL}/store/checkout/test-cash`, {
      headers: { 'x-publishable-api-key': PUB_KEY },
    })
    if (!res.ok) return false
    const body = await res.json()
    return body?.enabled === true
  } catch {
    return false
  }
}
```

Em `src/app/checkout/create-preference.ts`, substitua a função `createPreference` inteira por:

```ts
export type CheckoutItem = {
  title: string
  quantity: number
  price: number
  variantId?: string
  productId: string
}

// Shared by every checkout submission so the backend receives the same shape
// regardless of payment method.
export function buildCheckoutRequestBody(items: CheckoutItem[], address: Address, shipping: ShippingRate) {
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0) + shipping.price
  return { items, address, shipping, total, document: address.document }
}

export async function createPreference(
  items: CheckoutItem[],
  address: Address,
  shipping: ShippingRate
): Promise<PreferenceData | null> {
  const res = await fetch(`${MEDUSA_URL}/store/checkout/preference`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
    body: JSON.stringify(buildCheckoutRequestBody(items, address, shipping)),
  })

  if (!res.ok) return null
  const { preference_id, external_reference } = await res.json()
  return { preferenceId: preference_id, externalReference: external_reference }
}
```

`src/app/checkout/create-test-cash-order.ts`:

```ts
import type { ShippingRate } from '@/lib/cart-store'
import { buildCheckoutRequestBody, type Address, type CheckoutItem } from './create-preference'

const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function createTestCashOrder(
  items: CheckoutItem[],
  address: Address,
  shipping: ShippingRate
): Promise<{ externalReference: string } | null> {
  try {
    const res = await fetch(`${MEDUSA_URL}/store/checkout/test-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': PUB_KEY,
      },
      body: JSON.stringify(buildCheckoutRequestBody(items, address, shipping)),
    })
    if (!res.ok) return null
    const { external_reference } = await res.json()
    return { externalReference: external_reference }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/storefront && pnpm vitest run src/lib/__tests__/test-cash.test.ts src/app/checkout/__tests__`
Expected: PASS (inclusive o `page.test.ts` existente de `createPreference`).

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/lib/test-cash.ts apps/storefront/src/lib/__tests__/test-cash.test.ts \
  apps/storefront/src/app/checkout/create-preference.ts apps/storefront/src/app/checkout/create-test-cash-order.ts \
  apps/storefront/src/app/checkout/__tests__/create-test-cash-order.test.ts
git commit -m "feat(storefront): adicionar clientes da api de pagamento em dinheiro de teste" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm"
```

---

### Task 6: Seletor de forma de pagamento no checkout

**Files:**
- Create: `apps/storefront/src/components/payment/PaymentMethodSelector.tsx`
- Modify: `apps/storefront/src/app/checkout/page.tsx`
- Create: `apps/storefront/src/app/checkout/__tests__/checkout-test-cash.test.tsx`

**Interfaces:**
- Consumes: `fetchTestCashEnabled` (Task 5), `createTestCashOrder`, `CheckoutItem` (Task 5).
- Produces:
  ```ts
  type PaymentMethod = 'mercadopago' | 'test_cash'
  PaymentMethodSelector(props: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

`src/app/checkout/__tests__/checkout-test-cash.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}))

// The MercadoPago Brick loads an external SDK; it is irrelevant to these tests.
vi.mock('next/dynamic', () => ({
  default: () => function BrickStub() { return <div data-testid="mp-brick" /> },
}))

import CheckoutPage from '../page'
import { useCartStore } from '@/lib/cart-store'

const rate = { id: 'pac', name: 'PAC', company: 'Correios', price: 2500, currency: 'brl', delivery_time: '5 dias' }

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

function stubBackend({ enabled, testCashResponse }: { enabled: boolean; testCashResponse?: Promise<unknown> }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/store/checkout/test-cash') && init?.method === 'POST') {
      return testCashResponse ?? jsonResponse({ external_reference: 'ref-test-1' })
    }
    if (u.endsWith('/store/checkout/test-cash')) return jsonResponse({ enabled })
    if (u.includes('viacep.com.br')) return jsonResponse({ erro: true })
    if (u.includes('/store/shipping/estimate')) return jsonResponse({ rates: [rate] })
    if (u.includes('/store/checkout/preference')) {
      return jsonResponse({ preference_id: 'pref-1', external_reference: 'ref-mp-1' })
    }
    throw new Error(`Unexpected fetch: ${u}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function seedCart() {
  // The page rehydrates the persisted cart on mount, so seed persisted storage.
  localStorage.setItem(
    'mercado-preto-cart',
    JSON.stringify({
      state: {
        items: [{ productId: 'prod-1', variantId: 'var-1', title: 'Camiseta', variantTitle: 'M', price: 7900, quantity: 1 }],
        selectedShipping: null,
      },
      version: 0,
    })
  )
}

// Address inputs have visual labels without htmlFor, so they are reached by
// position in the form (Nome, Sobrenome, E-mail, CPF/CNPJ, Telefone, CEP,
// Estado, Cidade, Endereço, Complemento).
async function fillAddressAndContinue(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const inputs = container.querySelectorAll<HTMLInputElement>('form input')
  await user.type(inputs[0], 'João')
  await user.type(inputs[1], 'Silva')
  await user.type(inputs[2], 'joao@email.com')
  await user.type(inputs[3], '11144477735')
  await user.type(inputs[5], '44300000')
  await user.type(inputs[6], 'BA')
  await user.type(inputs[7], 'Cachoeira')
  await user.type(inputs[8], 'Rua das Flores')
  await user.click(screen.getByRole('button', { name: /calcular frete/i }))
  await user.click(await screen.findByRole('radio', { name: /PAC/ }))
}

describe('CheckoutPage — test cash payment', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
    seedCart()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    push.mockClear()
    replace.mockClear()
  })

  it('does not offer the test cash option when the backend reports it disabled', async () => {
    const fetchMock = stubBackend({ enabled: false })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/store\/checkout\/test-cash$/), expect.anything())
    expect(screen.queryByTestId('payment-method-test-cash')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir para pagamento/i })).toBeInTheDocument()
  })

  it('creates the order without MercadoPago and redirects to the success page when test cash is chosen', async () => {
    const fetchMock = stubBackend({ enabled: true })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout/sucesso?test_cash=ref-test-1'))
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/store/checkout/preference'))).toBe(false)
    expect(useCartStore.getState().items).toEqual([])
  })

  it('keeps the MercadoPago flow when the option is available but not chosen', async () => {
    const fetchMock = stubBackend({ enabled: true })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    expect(await screen.findByTestId('payment-method-mp')).toBeChecked()
    await user.click(screen.getByRole('button', { name: /ir para pagamento/i }))

    expect(await screen.findByTestId('mp-brick')).toBeInTheDocument()
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/store/checkout/preference'))).toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('disables the submit button while the test order is being created (no double submit)', async () => {
    let resolveOrder!: (v: unknown) => void
    const pending = new Promise((r) => { resolveOrder = r })
    stubBackend({ enabled: true, testCashResponse: pending })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    expect(screen.getByTestId('submit-test-cash')).toBeDisabled()
    resolveOrder(jsonResponse({ external_reference: 'ref-test-1' }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
  })

  it('shows an error and stays on the shipping step when the test order fails', async () => {
    stubBackend({ enabled: true, testCashResponse: Promise.resolve(jsonResponse({ error: 'x' }, false)) })
    const user = userEvent.setup()
    const { container } = render(<CheckoutPage />)

    await fillAddressAndContinue(user, container)
    await user.click(await screen.findByTestId('payment-method-test-cash'))
    await user.click(screen.getByTestId('submit-test-cash'))

    expect(await screen.findByText('Erro ao criar o pedido de teste. Tente novamente.')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByTestId('submit-test-cash')).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/storefront && pnpm vitest run src/app/checkout/__tests__/checkout-test-cash.test.tsx`
Expected: FAIL — o primeiro teste falha em `expect(fetchMock).toHaveBeenCalledWith(.../test-cash...)`; os demais não encontram `payment-method-test-cash`.

Se o teste "does not offer..." falhar **antes** dessa asserção (ex.: o formulário de endereço não avança), o problema está no harness (seed do carrinho, índices dos inputs) — corrija o harness antes de seguir.

- [ ] **Step 3: Create `PaymentMethodSelector`**

`src/components/payment/PaymentMethodSelector.tsx`:

```tsx
export type PaymentMethod = 'mercadopago' | 'test_cash'

type Props = {
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
}

const OPTIONS: { id: PaymentMethod; label: string; testId: string; testOnly?: boolean }[] = [
  { id: 'mercadopago', label: 'Cartão / Pix (Mercado Pago)', testId: 'payment-method-mp' },
  { id: 'test_cash', label: 'Dinheiro (teste)', testId: 'payment-method-test-cash', testOnly: true },
]

export default function PaymentMethodSelector({ value, onChange }: Props) {
  return (
    <fieldset className="mt-6">
      <legend className="font-display font-bold text-onyx mb-3">Forma de pagamento</legend>
      <div className="space-y-3">
        {OPTIONS.map((option) => (
          <label
            key={option.id}
            className={`flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-colors ${
              value === option.id ? 'border-amber bg-amber/5' : 'border-sand-dark hover:border-amber/50'
            }`}
          >
            <input
              type="radio"
              name="payment-method"
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              className="accent-amber"
              data-testid={option.testId}
            />
            <span className="flex-1 font-semibold text-onyx">{option.label}</span>
            {option.testOnly && (
              <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-bold uppercase text-terracotta">
                Ambiente de teste
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
```

- [ ] **Step 4: Wire it into `page.tsx`**

Em `src/app/checkout/page.tsx`:

1. Imports — adicione:
   ```tsx
   import PaymentMethodSelector, { type PaymentMethod } from '@/components/payment/PaymentMethodSelector'
   import { fetchTestCashEnabled } from '@/lib/test-cash'
   import { createTestCashOrder } from './create-test-cash-order'
   ```
   e troque o import de `create-preference` por:
   ```tsx
   import { createPreference, type Address, type CheckoutItem, type PreferenceData } from './create-preference'
   ```

2. Estado — logo após `const [paid, setPaid] = useState(false)`:
   ```tsx
   const [testCashEnabled, setTestCashEnabled] = useState(false)
   const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago')

   useEffect(() => {
     let active = true
     fetchTestCashEnabled().then((enabled) => {
       if (active) setTestCashEnabled(enabled)
     })
     return () => { active = false }
   }, [])

   const isTestCash = testCashEnabled && paymentMethod === 'test_cash'
   ```

3. Substitua a função `handleShippingSubmit` inteira por:
   ```tsx
   function checkoutItems(): CheckoutItem[] {
     return items.map((i) => ({
       title: i.title,
       quantity: i.quantity,
       price: i.price,
       variantId: i.variantId,
       productId: i.productId,
     }))
   }

   async function handleShippingSubmit() {
     if (!selectedShipping) {
       setError('Selecione uma opção de entrega.')
       return
     }
     setError('')
     setLoading(true)

     if (isTestCash) {
       const order = await createTestCashOrder(checkoutItems(), address, selectedShipping)
       if (!order) {
         setError('Erro ao criar o pedido de teste. Tente novamente.')
         setLoading(false)
         return
       }
       setPaid(true)
       clear()
       router.push(`/checkout/sucesso?test_cash=${encodeURIComponent(order.externalReference)}`)
       return
     }

     const data = await createPreference(checkoutItems(), address, selectedShipping)

     if (!data) {
       setError('Erro ao preparar o pagamento. Tente novamente.')
       setLoading(false)
       return
     }

     setPreferenceData(data)
     setLoading(false)
     setStep('payment')
   }
   ```

4. Na etapa `shipping`, imediatamente antes de `{error && <p className="text-terracotta text-sm mt-3">{error}</p>}`, insira:
   ```tsx
                {testCashEnabled && (
                  <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
                )}
   ```

5. No botão "Ir para pagamento" da etapa `shipping`, adicione o atributo `data-testid={isTestCash ? 'submit-test-cash' : undefined}` e troque o texto `Ir para pagamento` por:
   ```tsx
                    {isTestCash ? 'Finalizar pedido (teste)' : 'Ir para pagamento'}
   ```
   (o `disabled={loading}` existente já cobre o duplo clique).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/storefront && pnpm vitest run src/app/checkout`
Expected: PASS (5 testes novos + existentes).

- [ ] **Step 6: Typecheck/lint**

Run: `cd apps/storefront && npx tsc --noEmit -p . && pnpm lint`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add apps/storefront/src/components/payment/PaymentMethodSelector.tsx apps/storefront/src/app/checkout/page.tsx \
  apps/storefront/src/app/checkout/__tests__/checkout-test-cash.test.tsx
git commit -m "feat(storefront): oferecer pagamento em dinheiro de teste no checkout" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm"
```

---

### Task 7: Página de sucesso para pedidos de teste

**Files:**
- Modify: `apps/storefront/src/app/checkout/sucesso/ConfirmationContent.tsx`
- Create: `apps/storefront/src/app/checkout/sucesso/__tests__/ConfirmationContent.test.tsx`

**Interfaces:**
- Consumes: URL `?test_cash=<ref>` produzida pela Task 6.
- Produces: `data-testid="confirmation-status"` com `data-status` ∈ `approved | pending | failed`.

- [ ] **Step 1: Write the failing test**

`src/app/checkout/sucesso/__tests__/ConfirmationContent.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let search = ''

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}))

import ConfirmationContent from '../ConfirmationContent'

describe('ConfirmationContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    search = ''
  })

  it('confirms a test cash order without calling the MercadoPago confirm endpoint', async () => {
    search = 'test_cash=ref-test-1'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ConfirmationContent />)

    const status = await screen.findByTestId('confirmation-status')
    expect(status).toHaveTextContent('Pedido confirmado!')
    expect(status).toHaveAttribute('data-status', 'approved')
    expect(screen.getByText(/pagamento em dinheiro \(teste\)/i)).toBeInTheDocument()
    expect(screen.getByText(/ref-test-1/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still confirms MercadoPago payments through the confirm endpoint', async () => {
    search = 'payment_id=42'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'approved',
        status_detail: 'accredited',
        external_reference: 'ref-mp-1',
        transaction_amount: 79,
        payer: {},
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ConfirmationContent />)

    expect(await screen.findByTestId('confirmation-status')).toHaveAttribute('data-status', 'approved')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/store\/checkout\/confirm\?payment_id=42$/)
    expect(screen.queryByText(/pagamento em dinheiro \(teste\)/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/storefront && pnpm vitest run src/app/checkout/sucesso`
Expected: FAIL — `Unable to find an element by: [data-testid="confirmation-status"]`.

- [ ] **Step 3: Implement**

Em `src/app/checkout/sucesso/ConfirmationContent.tsx`:

1. Após `const urlStatus = params.get('status')`:
   ```tsx
   // Test-cash orders (test environments only) never go through MercadoPago,
   // so there is no payment to confirm: the order already exists.
   const testCashRef = params.get('test_cash')
   ```
2. Troque `const [loading, setLoading] = useState(!!paymentId)` por:
   ```tsx
   const [loading, setLoading] = useState(!!paymentId && !testCashRef)
   ```
3. No `useEffect`, troque `if (!paymentId) return` por `if (!paymentId || testCashRef) return` e o array de dependências por `[paymentId, testCashRef]`.
4. Troque `const status = data?.status ?? urlStatus` por:
   ```tsx
   const status = testCashRef ? 'approved' : data?.status ?? urlStatus
   ```
5. No `<h1 className="font-display text-3xl font-black text-onyx">`, adicione os atributos:
   ```tsx
   data-testid="confirmation-status"
   data-status={isApproved ? 'approved' : isPending ? 'pending' : 'failed'}
   ```
6. Imediatamente antes de `{data && (`, insira:
   ```tsx
        {testCashRef && (
          <div className="mt-6 rounded-xl bg-white border border-sand-dark p-4 text-left text-sm space-y-2">
            <p className="text-onyx/60">
              <span className="font-semibold text-onyx">Forma de pagamento: </span>
              Pagamento em dinheiro (teste)
            </p>
            <p className="text-onyx/40 text-xs font-mono pt-1">Ref: {testCashRef}</p>
          </div>
        )}
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/storefront && pnpm vitest run src/app/checkout`
Expected: PASS.

- [ ] **Step 5: Full storefront suite + typecheck**

Run: `cd apps/storefront && pnpm test && npx tsc --noEmit -p .`
Expected: todas as suítes verdes; nenhum erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/app/checkout/sucesso/ConfirmationContent.tsx \
  apps/storefront/src/app/checkout/sucesso/__tests__/ConfirmationContent.test.tsx
git commit -m "feat(storefront): exibir confirmação de pedido pago em dinheiro de teste" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ENzq6CzFkxpER7RGsj6gbm"
```

---

## Verificação final (após Task 7)

- [ ] `cd packages/medusa-backend/apps/backend && pnpm test:unit` → tudo verde.
- [ ] `cd apps/storefront && pnpm test` → tudo verde.
- [ ] `grep -c TEST_CASH infra/docker-compose.prod.yml` → `0`.
- [ ] Revisão do branch inteiro antes do PR para `develop`.
