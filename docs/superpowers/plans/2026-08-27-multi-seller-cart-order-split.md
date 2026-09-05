# Split de Pedido por Vendedor no Checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um comprador paga uma vez por um carrinho com produtos de vendedores diferentes, o backend cria um pedido por vendedor (não mais um único pedido com `seller_id: "unknown"`), corrigindo também a atribuição de todo pedido de vendedor único.

**Architecture:** O vendedor de cada item é resolvido no backend (nunca no navegador) a partir do `productId`, via o link Medusa `seller-product` já existente. A rota que cria a preferência MercadoPago agrupa os itens por vendedor e grava esse agrupamento no metadata da preferência. O webhook de pagamento aprovado lê esse agrupamento e cria N pedidos (um por vendedor) a partir de um único pagamento, com idempotência por `(external_reference, seller_id)`.

**Tech Stack:** Next.js (storefront) + Medusa v2 (backend), Zod, Jest (backend, `*.unit.spec.ts`) e Vitest (storefront, `*.test.ts`), `@medusajs/framework/utils` `ContainerRegistrationKeys.QUERY` / `query.graph`.

**Spec:** `docs/superpowers/specs/2026-08-27-multi-seller-cart-order-split-design.md`

## Global Constraints

- Nenhuma mudança em `apps/storefront/src/lib/cart-store.ts` ou nos componentes de carrinho (`AddToCartButton.tsx`, `ProductDetails.tsx`) — resolução de vendedor é 100% server-side.
- `metadata.items`, `metadata.shipping`, `metadata.total` da preferência MercadoPago continuam existindo tal como hoje (visão "carrinho inteiro" usada por `ConfirmationContent.tsx`) — não remover, só adicionar `metadata.seller_groups` ao lado.
- `commission-on-payment.ts` e `order-fiscal-emit.ts` não mudam de código — já operam por `order.id`.
- Compatibilidade retroativa no webhook: se `meta.seller_groups` estiver ausente, cai num único grupo derivado de `meta.seller_id` / `meta.items` / `meta.shipping` — mesmo comportamento de hoje.
- Frete continua sendo uma única cotação para o carrinho inteiro (rateio proporcional entre grupos, não cálculo real por origem — fora de escopo, ver `docs/superpowers/specs/2026-08-27-frete-segmentado-por-loja-scope.md`).

---

## Task 1: Utilitário puro de agrupamento por vendedor + rateio de frete

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/seller-order-groups.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/seller-order-groups.unit.spec.ts`

**Interfaces:**
- Produces: `PreferenceItem` type (`{ title: string; quantity: number; price: number; variantId?: string; productId: string }`), `SellerGroup` type (`{ sellerId: string; subtotal: number; shippingShare: number; items: Array<{ variant_id?: string; title: string; quantity: number; price: number }> }`), `groupItemsBySeller(items: PreferenceItem[], sellerByProductId: Record<string, string>, shippingPrice: number): { groups: SellerGroup[] } | { unresolvedProductId: string }`. Task 2 (rota de preferência) e Task 4 (webhook) importam `SellerGroup` e `groupItemsBySeller` deste arquivo.

- [ ] **Step 1: Escrever os testes (RED)**

```ts
// packages/medusa-backend/apps/backend/src/utils/__tests__/seller-order-groups.unit.spec.ts
import { groupItemsBySeller, type PreferenceItem } from "../seller-order-groups"

const item = (overrides: Partial<PreferenceItem>): PreferenceItem => ({
  title: "Item",
  quantity: 1,
  price: 1000,
  productId: "prod-1",
  ...overrides,
})

describe("groupItemsBySeller", () => {
  it("returns a single group when all items belong to the same seller", () => {
    const items = [item({ productId: "prod-1", price: 1000 }), item({ productId: "prod-1", price: 500 })]
    const result = groupItemsBySeller(items, { "prod-1": "seller-a" }, 0)

    expect("groups" in result && result.groups).toEqual([
      { sellerId: "seller-a", subtotal: 1500, shippingShare: 0, items: expect.any(Array) },
    ])
  })

  it("splits items from different sellers into separate groups", () => {
    const items = [
      item({ productId: "prod-1", price: 1000 }),
      item({ productId: "prod-2", price: 500 }),
    ]
    const result = groupItemsBySeller(items, { "prod-1": "seller-a", "prod-2": "seller-b" }, 0)

    expect("groups" in result).toBe(true)
    const groups = (result as { groups: any[] }).groups
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.sellerId).sort()).toEqual(["seller-a", "seller-b"])
  })

  it("splits shipping proportionally to each group's subtotal", () => {
    const items = [
      item({ productId: "prod-1", price: 7500 }), // 75% do subtotal
      item({ productId: "prod-2", price: 2500 }), // 25% do subtotal
    ]
    const result = groupItemsBySeller(items, { "prod-1": "seller-a", "prod-2": "seller-b" }, 1000)

    const groups = (result as { groups: any[] }).groups
    const a = groups.find((g) => g.sellerId === "seller-a")
    const b = groups.find((g) => g.sellerId === "seller-b")
    expect(a.shippingShare).toBe(750)
    expect(b.shippingShare).toBe(250)
  })

  it("assigns the rounding remainder to the group with the largest subtotal", () => {
    // subtotais 100 / 90 / 110 (total 300) sobre frete 1000 não dividem exato:
    // floor(1000*100/300)=333, floor(1000*90/300)=300, floor(1000*110/300)=366 → soma 999, falta 1.
    // O centavo que falta vai para seller-c (maior subtotal, 110), sem ambiguidade de empate.
    const items = [
      item({ productId: "prod-1", price: 100 }), // seller-a
      item({ productId: "prod-2", price: 90 }),  // seller-b
      item({ productId: "prod-3", price: 110 }), // seller-c — maior subtotal
    ]
    const result = groupItemsBySeller(
      items,
      { "prod-1": "seller-a", "prod-2": "seller-b", "prod-3": "seller-c" },
      1000
    )

    const groups = (result as { groups: any[] }).groups
    const totalShipping = groups.reduce((sum, g) => sum + g.shippingShare, 0)
    expect(totalShipping).toBe(1000) // nunca perde nem ganha centavo no total

    const byId = Object.fromEntries(groups.map((g) => [g.sellerId, g.shippingShare]))
    expect(byId["seller-a"]).toBe(333)
    expect(byId["seller-b"]).toBe(300)
    expect(byId["seller-c"]).toBe(367) // 366 + o centavo do resto
  })

  it("returns unresolvedProductId when an item's product has no known seller", () => {
    const items = [item({ productId: "prod-ghost" })]
    const result = groupItemsBySeller(items, {}, 0)

    expect(result).toEqual({ unresolvedProductId: "prod-ghost" })
  })

  it("returns an empty group list for an empty cart without dividing by zero", () => {
    const result = groupItemsBySeller([], {}, 500)
    expect(result).toEqual({ groups: [] })
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar falha (arquivo `seller-order-groups.ts` ainda não existe)**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit -- src/utils/__tests__/seller-order-groups.unit.spec.ts`
Expected: FAIL — `Cannot find module '../seller-order-groups'`

- [ ] **Step 3: Implementação mínima (GREEN)**

```ts
// packages/medusa-backend/apps/backend/src/utils/seller-order-groups.ts
export type PreferenceItem = {
  title: string
  quantity: number
  price: number
  variantId?: string
  productId: string
}

export type SellerGroup = {
  sellerId: string
  subtotal: number
  shippingShare: number
  items: Array<{ variant_id?: string; title: string; quantity: number; price: number }>
}

export function groupItemsBySeller(
  items: PreferenceItem[],
  sellerByProductId: Record<string, string>,
  shippingPrice: number
): { groups: SellerGroup[] } | { unresolvedProductId: string } {
  for (const item of items) {
    if (!sellerByProductId[item.productId]) {
      return { unresolvedProductId: item.productId }
    }
  }

  const order: string[] = []
  const bySeller = new Map<string, { subtotal: number; items: SellerGroup["items"] }>()

  for (const item of items) {
    const sellerId = sellerByProductId[item.productId]
    if (!bySeller.has(sellerId)) {
      bySeller.set(sellerId, { subtotal: 0, items: [] })
      order.push(sellerId)
    }
    const group = bySeller.get(sellerId)!
    group.subtotal += item.price * item.quantity
    group.items.push({
      variant_id: item.variantId,
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    })
  }

  if (order.length === 0) return { groups: [] }

  const cartSubtotal = order.reduce((sum, id) => sum + bySeller.get(id)!.subtotal, 0)

  const shares = order.map((id) => {
    const subtotal = bySeller.get(id)!.subtotal
    return cartSubtotal > 0 ? Math.floor((shippingPrice * subtotal) / cartSubtotal) : 0
  })

  const allocated = shares.reduce((sum, s) => sum + s, 0)
  const remainder = shippingPrice - allocated

  if (remainder !== 0) {
    let largestIndex = 0
    let largestSubtotal = -1
    order.forEach((id, i) => {
      const subtotal = bySeller.get(id)!.subtotal
      if (subtotal > largestSubtotal) {
        largestSubtotal = subtotal
        largestIndex = i
      }
    })
    shares[largestIndex] += remainder
  }

  return {
    groups: order.map((id, i) => ({
      sellerId: id,
      subtotal: bySeller.get(id)!.subtotal,
      shippingShare: shares[i],
      items: bySeller.get(id)!.items,
    })),
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar sucesso**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit -- src/utils/__tests__/seller-order-groups.unit.spec.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/seller-order-groups.ts packages/medusa-backend/apps/backend/src/utils/__tests__/seller-order-groups.unit.spec.ts
git commit -m "feat(checkout): adiciona agrupamento de itens do carrinho por vendedor"
```

---

## Task 2: Resolver vendedor e gravar `seller_groups` em `checkout/preference`

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`
- Modify (rewrite `makeReq`/`validBody`, add novos testes): `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `groupItemsBySeller`, `SellerGroup`, `PreferenceItem` de `../../../../utils/seller-order-groups` (Task 1).
- Produces: `metadata.seller_groups: SellerGroup[]` na preferência MercadoPago criada por esta rota — Task 4 (webhook) lê esse campo.

- [ ] **Step 1: Atualizar `makeReq`/`validBody` no teste existente para o novo contrato (ainda vai falhar — RED)**

No topo de `route.unit.spec.ts`, troque o `makeReq` e o `validBody` por:

```ts
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

const makeReq = (
  body: unknown,
  env: Record<string, string> = {},
  sellerByProductId: Record<string, string> = { "prod-1": "seller-1" }
) => {
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-token",
    STORE_CORS: "http://localhost:3000",
    BACKEND_URL: "",
    ...env,
  })
  const graph = jest.fn().mockResolvedValue({
    data: Object.entries(sellerByProductId).map(([id, sellerId]) => ({ id, seller: { id: sellerId } })),
  })
  return {
    body,
    scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    _graph: graph,
  } as any
}
```

Troque `validBody` (remova `sellerId`, adicione `productId` ao item):

```ts
const validBody = {
  items: [{ title: "Camiseta", quantity: 1, price: 7900, variantId: "var-1", productId: "prod-1" }],
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
  total: 10400,
  document: "111.444.777-35",
}
```

Adicione estes testes novos ao final do `describe`:

```ts
  it("returns 400 when an item's product has no seller association", async () => {
    const res = makeRes()
    await POST(makeReq(validBody, {}, {}), res) // sellerByProductId vazio → prod-1 não resolve

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Produto sem vendedor associado.")
  })

  it("writes seller_groups (not seller_id) to the preference metadata", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.metadata.seller_id).toBeUndefined()
    expect(body.metadata.seller_groups).toEqual([
      expect.objectContaining({ sellerId: "seller-1", subtotal: 7900 }),
    ])
  })

  it("splits seller_groups across sellers for a multi-seller cart", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const body = {
      ...validBody,
      items: [
        { title: "Camiseta", quantity: 1, price: 7500, variantId: "var-1", productId: "prod-1" },
        { title: "Sabonete", quantity: 1, price: 2500, variantId: "var-2", productId: "prod-2" },
      ],
    }
    await POST(makeReq(body, {}, { "prod-1": "seller-1", "prod-2": "seller-2" }), makeRes())

    const created = mockPreferenceCreate.mock.calls[0][0].body
    expect(created.metadata.seller_groups).toHaveLength(2)
    expect(created.metadata.seller_groups.map((g: any) => g.sellerId).sort()).toEqual(["seller-1", "seller-2"])
  })

  it("still includes the flat items/shipping/total metadata used by the confirmation screen", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.metadata.items).toEqual([
      expect.objectContaining({ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }),
    ])
    expect(body.metadata.shipping).toEqual({ id: "pac", name: "PAC", price: 2500 })
    expect(body.metadata.total).toBe(10400)
  })
```

- [ ] **Step 2: Rodar os testes e confirmar falha**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit -- src/api/store/checkout/preference/__tests__/route.unit.spec.ts`
Expected: FAIL — testes existentes quebram (schema ainda não aceita `productId` nem rejeita a ausência de `sellerId` da forma esperada; `req.scope` ainda não é usado pela rota) e os testes novos falham (`seller_groups` ainda não existe).

- [ ] **Step 3: Implementar na rota (GREEN)**

Em `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`:

Adicione os imports:

```ts
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { groupItemsBySeller } from "../../../../utils/seller-order-groups"
```

Troque o schema do item (linhas 8-14 hoje) por:

```ts
  items: z.array(
    z.object({
      title: z.string(),
      quantity: z.number().int().positive(),
      price: z.number().int().positive(),
      variantId: z.string().optional(),
      productId: z.string(),
    })
  ),
```

Remova a linha `sellerId: z.string().optional(),` do schema do body.

Troque a linha `const { items, address, shipping, total, sellerId, document } = parsed.data` por:

```ts
  const { items, address, shipping, total, document } = parsed.data
```

Logo em seguida, antes da criação da preferência, adicione:

```ts
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
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
    return res.status(400).json({
      error: "Produto sem vendedor associado.",
      productId: grouped.unresolvedProductId,
    })
  }
```

Na `metadata` passada para `preference.create` (dentro do `body`), troque `seller_id: sellerId,` por `seller_groups: grouped.groups,`.

- [ ] **Step 4: Rodar os testes e confirmar sucesso**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit -- src/api/store/checkout/preference/__tests__/route.unit.spec.ts`
Expected: PASS (todos os testes, existentes + novos)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts packages/medusa-backend/apps/backend/src/api/store/checkout/preference/__tests__/route.unit.spec.ts
git commit -m "feat(checkout): resolve vendedor por produto e grava seller_groups na preferencia MP"
```

---

## Task 3: Enviar `productId` no payload do checkout (frontend)

**Files:**
- Modify: `apps/storefront/src/app/checkout/page.tsx`
- Create: `apps/storefront/src/app/checkout/__tests__/page.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (mudança independente no frontend).
- Produces: corpo de `POST /store/checkout/preference` agora inclui `productId` por item — é o que a Task 2 (já implementada) espera receber em produção.

- [ ] **Step 1: Escrever o teste (RED)**

```ts
// apps/storefront/src/app/checkout/__tests__/page.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreference } from '../page'

describe('createPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes productId for each item in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ preference_id: 'pref-1', external_reference: 'ref-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createPreference(
      [{ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' }],
      {
        firstName: 'João', lastName: 'Silva', email: 'joao@email.com', phone: '',
        document: '111.444.777-35', cep: '44300-000', address1: 'Rua X', address2: '',
        city: 'Cachoeira', state: 'BA',
      },
      { id: 'pac', name: 'PAC', company: 'Correios', price: 2500, currency: 'brl', delivery_time: '5 dias' }
    )

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse((init as RequestInit).body as string)
    expect(sentBody.items[0]).toEqual(
      expect.objectContaining({ title: 'Camiseta', quantity: 1, price: 7900, variantId: 'var-1', productId: 'prod-1' })
    )
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar falha**

Run: `cd apps/storefront && npm run test -- src/app/checkout/__tests__/page.test.ts`
Expected: FAIL — `createPreference` não é exportada por `../page` ainda, e o `productId` não é enviado.

- [ ] **Step 3: Implementação (GREEN)**

Em `apps/storefront/src/app/checkout/page.tsx`:

Troque a assinatura de `createPreference` (linha 62-66 hoje):

```ts
export async function createPreference(
  items: { title: string; quantity: number; price: number; variantId?: string; productId: string }[],
  address: Address,
  shipping: ShippingRate
): Promise<PreferenceData | null> {
```

Troque o `.map` que monta os itens do carrinho na chamada de `createPreference` (linha 148-152 hoje, dentro de `handleShippingSubmit`):

```ts
    const data = await createPreference(
      items.map((i) => ({
        title: i.title,
        quantity: i.quantity,
        price: i.price,
        variantId: i.variantId,
        productId: i.productId,
      })),
      address,
      selectedShipping
    )
```

- [ ] **Step 4: Rodar o teste e confirmar sucesso**

Run: `cd apps/storefront && npm run test -- src/app/checkout/__tests__/page.test.ts`
Expected: PASS

- [ ] **Step 5: Rodar a suíte completa do storefront (checar regressão)**

Run: `cd apps/storefront && npm run test`
Expected: PASS (nenhum teste existente quebrado)

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/app/checkout/page.tsx apps/storefront/src/app/checkout/__tests__/page.test.ts
git commit -m "feat(checkout): envia productId de cada item no payload da preferencia MP"
```

---

## Task 4: Criar um pedido por vendedor no webhook de pagamento aprovado

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `SellerGroup` de `../../../utils/seller-order-groups` (Task 1); `metadata.seller_groups` gravado pela Task 2.
- Produces: N pedidos criados via `orderService.createOrders`, cada um com `metadata.seller_id` real (não mais sempre `"unknown"`/`undefined`) — é o que corrige `commission-on-payment.ts`, `order-fiscal-emit.ts` e `api/seller/orders/route.ts` sem tocar nesses três arquivos.

- [ ] **Step 1: Escrever os testes novos (RED)**

Adicione ao final do `describe("POST /webhooks/mercadopago", ...)` em `route.unit.spec.ts` (mantendo os testes existentes intactos — eles continuam cobrindo o caminho de compatibilidade sem `seller_groups`):

```ts
  const twoSellerGroupsMetadata = {
    address: preferenceMetadata.address,
    seller_groups: [
      {
        sellerId: "seller-a",
        subtotal: 7500,
        shippingShare: 1125,
        items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7500 }],
      },
      {
        sellerId: "seller-b",
        subtotal: 2500,
        shippingShare: 375,
        items: [{ variant_id: "var-2", title: "Sabonete", quantity: 1, price: 2500 }],
      },
    ],
    shipping: { id: "pac", name: "PAC", price: 1500 },
    total: 11500,
  }

  it("creates one order per seller group when seller_groups is present", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.createOrders.mockResolvedValue([{ id: "order-a" }, { id: "order-b" }])

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders).toHaveLength(2)
    expect(createdOrders.map((o: any) => o.metadata.seller_id).sort()).toEqual(["seller-a", "seller-b"])
    expect(createdOrders.find((o: any) => o.metadata.seller_id === "seller-a").shipping_methods[0].amount).toBe(1125)
    expect(createdOrders.find((o: any) => o.metadata.seller_id === "seller-b").shipping_methods[0].amount).toBe(375)
  })

  it("emits order.placed and mercadopago.order_approved once per created order", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.createOrders.mockResolvedValue([{ id: "order-a" }, { id: "order-b" }])

    await POST(req, makeRes())

    expect(req._eventBusService.emit).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "order.placed", data: { id: "order-a" } }),
        expect.objectContaining({ name: "mercadopago.order_approved", data: { id: "order-a" } }),
        expect.objectContaining({ name: "order.placed", data: { id: "order-b" } }),
        expect.objectContaining({ name: "mercadopago.order_approved", data: { id: "order-b" } }),
      ])
    )
  })

  it("only creates orders for seller groups that don't already exist (partial idempotency)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.listOrders.mockImplementation((filter: any) => {
      const sellerId = filter.metadata.seller_id
      return Promise.resolve(sellerId === "seller-a" ? [{ id: "order-a-existing" }] : [])
    })
    req._orderService.createOrders.mockResolvedValue([{ id: "order-b" }])

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders).toHaveLength(1)
    expect(createdOrders[0].metadata.seller_id).toBe("seller-b")
  })

  it("skips order creation entirely when every seller group's order already exists", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.listOrders.mockResolvedValue([{ id: "existing" }])

    const res = makeRes()
    await POST(req, res)

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })

  it("falls back to a single group derived from seller_id/items/shipping when seller_groups is absent", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata }) // sem seller_groups, tem seller_id: "seller-abc"

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders).toHaveLength(1)
    expect(createdOrders[0].metadata.seller_id).toBe("seller-abc")
  })
```

- [ ] **Step 2: Rodar os testes e confirmar falha**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit -- src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`
Expected: FAIL nos 5 testes novos (a rota ainda cria um único pedido, sem olhar `seller_groups`, sem idempotência por grupo).

- [ ] **Step 3: Implementar no webhook (GREEN)**

Em `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts`, adicione o import:

```ts
import type { SellerGroup } from "../../../utils/seller-order-groups"
```

Substitua o bloco inteiro desde `const addr = meta?.address...` (hoje linha 142) até o fechamento do `if (payment.status === "approved") { ... }` (hoje linha 202, logo antes de `res.sendStatus(200)`) por:

```ts
      const addr = meta?.address as Record<string, string> | undefined
      const shipping: { name: string; price: number } | undefined = meta?.shipping

      const sellerGroups: SellerGroup[] = Array.isArray(meta?.seller_groups)
        ? meta.seller_groups
        : [
            {
              sellerId: meta?.seller_id,
              subtotal: 0,
              shippingShare: shipping?.price ?? 0,
              items: meta?.items ?? [],
            } as SellerGroup,
          ]

      const orderService = req.scope.resolve(Modules.ORDER)
      const eventBusService = req.scope.resolve(Modules.EVENT_BUS)

      const pendingGroups: SellerGroup[] = []
      for (const group of sellerGroups) {
        const existing = await orderService.listOrders(
          {
            metadata: {
              mercadopago_external_reference: payment.external_reference,
              seller_id: group.sellerId,
            },
          } as any,
          { take: 1 }
        )
        if (existing.length === 0) pendingGroups.push(group)
      }

      if (pendingGroups.length === 0) {
        logger.info(
          `[mercadopago/webhook] todos os pedidos já existem para ref ${payment.external_reference} — ignorando webhook duplicado`
        )
        return res.sendStatus(200)
      }

      const createdOrders = await orderService.createOrders(
        pendingGroups.map((group) => ({
          currency_code: "brl",
          email: addr?.email ?? (payment.payer as any)?.email,
          shipping_address: {
            first_name: addr?.first_name ?? (payment.payer as any)?.name ?? "",
            last_name: addr?.last_name ?? (payment.payer as any)?.surname ?? "",
            phone: addr?.phone ?? (payment.payer as any)?.phone?.number ?? "",
            address_1: addr?.address_1 ?? (payment.payer as any)?.address?.street_name ?? "",
            address_2: addr?.address_2 ?? "",
            city: addr?.city ?? "",
            province: addr?.state ?? "",
            country_code: "br",
            postal_code: addr?.postal_code ?? (payment.payer as any)?.address?.zip_code ?? "",
          },
          items: group.items.map((i) => ({
            title: i.title,
            quantity: i.quantity,
            unit_price: i.price,
            ...(i.variant_id ? { variant_id: i.variant_id } : {}),
          })),
          shipping_methods: shipping ? [{ name: shipping.name, amount: group.shippingShare }] : [],
          metadata: {
            mercadopago_payment_id: String(payment.id),
            mercadopago_external_reference: payment.external_reference,
            seller_id: group.sellerId,
            buyer_document: meta?.buyer_document,
          },
        }))
      )

      logger.info(
        `[mercadopago/webhook] ${createdOrders.length} pedido(s) criado(s) para ref ${payment.external_reference}`
      )

      // order.placed              → WhatsApp de confirmação
      // mercadopago.order_approved → emissão NF-e (evento customizado para evitar
      //                              conflito com subscriber interno do Medusa para
      //                              order.payment_captured)
      await eventBusService.emit(
        createdOrders.flatMap((order: any) => [
          { name: "order.placed", data: { id: order.id } },
          { name: "mercadopago.order_approved", data: { id: order.id } },
        ])
      )
```

Remova a declaração antiga de `mpItems` (não é mais usada — os itens agora vêm de `group.items`).

- [ ] **Step 4: Rodar os testes e confirmar sucesso**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit -- src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`
Expected: PASS (todos os testes, existentes + 5 novos)

- [ ] **Step 5: Rodar a suíte completa do backend (checar regressão)**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit`
Expected: PASS (nenhum teste existente quebrado, incluindo `commission-on-payment` e `order-fiscal-emit`, que não mudaram de código)

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts
git commit -m "feat(checkout): cria um pedido por vendedor no webhook de pagamento aprovado"
```

---

## Task 5: Verificação manual ponta a ponta em `teste.mercadopreto.com.br`

**Files:** nenhum arquivo de código — só verificação.

**Interfaces:**
- Consumes: o sistema completo, pós-deploy das Tasks 1-4.
- Produces: confirmação de que o fluxo funciona de ponta a ponta antes de liberar para teste externo (Aylton).

- [ ] **Step 1: Deploy das Tasks 1-4 em `teste.mercadopreto.com.br`**

Seguir o processo de deploy já documentado em `docs/DEPLOY_OCI.md` para atualizar o container `mercado-preto-api` e `mercado-preto-storefront` com o código das 4 tasks.

- [ ] **Step 2: Montar carrinho com produtos de 2 lojas diferentes**

No storefront de teste, adicionar ao carrinho pelo menos 1 produto de 2 vendedores diferentes (ex.: "LOJA FIX SISTEMAS" e "Mulheres de Axé do Brasil", já cadastradas conforme `docs/qa/2026-08-25-multi-seller-order-test.md`).

- [ ] **Step 3: Finalizar o checkout com um único pagamento**

Completar o fluxo de checkout até a tela de pagamento (Bricks) e pagar com um cartão de teste sandbox (prefixo `TEST-` já confirmado no ambiente). Confirmar que só **um** pagamento é solicitado — não um por loja.

- [ ] **Step 4: Confirmar 2 pedidos distintos, um por vendedor**

No painel de cada vendedor (`/painel/pedidos`), confirmar que o pedido correspondente aparece — cada um só com os itens daquele vendedor, e com `seller_id` correto (verificável via log do backend ou painel admin).

- [ ] **Step 5: Confirmar comissão e NF-e (sandbox) por pedido**

Verificar, no painel admin (`/app` → Comissões) que cada um dos 2 pedidos gerou uma comissão separada, e que a emissão de NF-e (sandbox, `FOCUS_NFE_SANDBOX=true`) rodou para cada pedido sem erro (log do backend ou painel de status fiscal).

- [ ] **Step 6: Registrar o resultado**

Documentar o resultado em `docs/qa/` seguindo o padrão de `docs/qa/2026-08-25-multi-seller-order-test.md` (novo arquivo, ex. `docs/qa/2026-08-27-multi-seller-order-split-verification.md`), e então liberar o ambiente para o teste externo do Aylton.
