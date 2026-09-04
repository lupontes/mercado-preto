# Reconciliação split-por-vendedor + persistência de snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mergear `fix/checkout-metadata-persistence` em `fix/multi-seller-cart-order-split`, combinando as duas mudanças ortogonais (split por vendedor em `seller_groups` + persistência de snapshot local do checkout) nos dois arquivos onde elas colidem.

**Architecture:** `git merge` normal entre as duas branches irmãs (mesmo commit-base `d437c4b`); conflito confinado a `preference/route.ts`, `webhooks/mercadopago/route.ts` e seus `__tests__/*.unit.spec.ts`. O módulo `checkout` inteiro (model/service/migration) e todo o resto do diff de `fix/checkout-metadata-persistence` entram sem conflito, via merge automático do git.

**Tech Stack:** TypeScript, Medusa v2, Zod, Jest (`ts-jest`/`@swc/jest`), MercadoPago SDK.

**Spec:** `docs/superpowers/specs/2026-09-03-checkout-metadata-seller-groups-reconciliation-design.md`

## Global Constraints

- Mensagens de commit em português, Conventional Commits, imperativo, minúsculo, sem ponto final.
- TDD: toda mudança de comportamento tem teste antes ou junto da implementação.
- `checkoutSnapshotPayload` carrega `seller_groups` (não mais `seller_id` solto) — ver spec, seção "Formato do snapshot".
- Guarda de "nada recuperado" no webhook é feita sobre `meta?.items` (payload como um todo), nunca por grupo individual.
- Nenhuma mudança no módulo `checkout`, em `groupItemsBySeller`, ou no storefront — nenhum desses arquivos diverge entre as duas branches.

---

## Task 1: Resolver o merge em `preference/route.ts`

**Files:**
- Modify (durante o merge): `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`
- Modify (durante o merge): `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `groupItemsBySeller(items, sellerByProductId, shippingPrice)` de `../../../../utils/seller-order-groups.ts` — retorna `{ groups: SellerGroup[] } | { unresolvedProductId: string }`, `SellerGroup = { sellerId: string; subtotal: number; shippingShare: number; items: Array<{variant_id?: string; title: string; quantity: number; price: number}> }`. `CHECKOUT_MODULE` (string `"checkout"`) e tipo `CheckoutModuleService` de `../../../../modules/checkout` — método `recordSnapshot(externalReference: string, payload: Record<string, unknown>): Promise<any>`, `attachPreferenceId(externalReference: string, preferenceId: string): Promise<void>`.
- Produces: `checkoutSnapshotPayload` no formato `{ seller_groups, buyer_document, address, items, shipping, total }` — Task 2 (webhook) consome exatamente esse formato ao ler o snapshot de volta.

Este arquivo já está em conflito de merge no momento em que esta task começa (`git status` mostra `both modified` para os dois arquivos abaixo). **Não rode `git merge --abort`.** A resolução completa do merge (incluindo o outro arquivo em conflito, `webhooks/mercadopago/route.ts`) é feita na Task 2 — esta task resolve só o par `preference/route.ts` + seu teste, sem finalizar o commit do merge.

- [ ] **Step 1: Iniciar o merge**

Estando em `fix/multi-seller-cart-order-split` (branch atual do repo principal, não um worktree):

```bash
git merge --no-ff fix/checkout-metadata-persistence
```

Espera-se: merge para com conflito, listando `both modified` em `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`, `.../preference/__tests__/route.unit.spec.ts`, `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts` e `.../mercadopago/__tests__/route.unit.spec.ts`. Todo o resto (módulo `checkout/`, docs, `pnpm-lock.yaml` se aplicável) mergeia automaticamente.

- [ ] **Step 2: Substituir `preference/route.ts` pelo conteúdo combinado**

Sobrescreva o arquivo inteiro (resolvendo o conflito) com:

```ts
import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Preference } from "mercadopago"
import { z } from "zod"
import { validateDocument } from "../../../../utils/validate-document"
import { groupItemsBySeller } from "../../../../utils/seller-order-groups"
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"

const schema = z.object({
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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(503).json({ error: "MercadoPago não configurado." })
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }

  const { items, address, shipping, total, document } = parsed.data
  const { digits: buyerDocument } = validateDocument(document)
  const storeCors = process.env.STORE_CORS?.split(",")[0] ?? "http://localhost:3000"
  const backendUrl = process.env.BACKEND_URL

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

  const externalReference = crypto.randomUUID()

  const checkoutSnapshotPayload = {
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
  }

  const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)

  try {
    await checkoutService.recordSnapshot(externalReference, checkoutSnapshotPayload)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return res.status(500).json({ error: "Erro ao salvar snapshot do checkout.", detail: msg })
  }

  const mp = new MercadoPagoConfig({ accessToken })
  const preference = new Preference(mp)

  try {
    const result = await preference.create({
      body: {
        items: [
          ...items.map((item) => ({
            id: item.variantId ?? item.title.toLowerCase().replace(/\s+/g, "-"),
            title: item.title,
            quantity: item.quantity,
            unit_price: item.price / 100,
            currency_id: "BRL",
          })),
          ...(shipping.price > 0
            ? [
                {
                  id: `frete-${shipping.id}`,
                  title: `Frete — ${shipping.name}`,
                  quantity: 1,
                  unit_price: shipping.price / 100,
                  currency_id: "BRL",
                },
              ]
            : []),
        ],
        payer: {
          name: address.firstName,
          surname: address.lastName,
          email: address.email,
          phone: address.phone ? { number: address.phone } : undefined,
          address: {
            street_name: address.address1,
            street_number: address.address2 ?? "",
            zip_code: address.cep.replace(/\D/g, ""),
          },
        },
        payment_methods: {
          installments: 12,
        },
        back_urls: {
          success: `${storeCors}/checkout/sucesso`,
          failure: `${storeCors}/checkout/erro`,
          pending: `${storeCors}/checkout/pendente`,
        },
        ...(storeCors.startsWith("https") ? { auto_return: "approved" } : {}),
        statement_descriptor: "MERCADO PRETO",
        external_reference: externalReference,
        // notification_url só funciona com URL pública (HTTPS). Em desenvolvimento local,
        // configure BACKEND_URL com uma URL de túnel (ex: ngrok) para receber webhooks.
        ...(backendUrl ? { notification_url: `${backendUrl}/webhooks/mercadopago` } : {}),
        // Snapshot do pedido pra rastreabilidade via webhook — mesmo payload
        // gravado no nosso banco acima (checkoutSnapshotPayload), fonte de
        // verdade primária caso payment.metadata volte vazio.
        metadata: checkoutSnapshotPayload,
      },
    })

    try {
      await checkoutService.attachPreferenceId(externalReference, result.id as string)
    } catch (attachErr: unknown) {
      const logger = req.scope.resolve("logger") as { warn: (msg: string) => void }
      logger.warn(`[checkout/preference] falha ao gravar preferenceId no snapshot: ${attachErr}`)
    }

    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      external_reference: externalReference,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    res.status(500).json({ error: "Erro ao criar preferência MercadoPago.", detail: msg })
  }
}
```

- [ ] **Step 3: Substituir o teste pelo conteúdo combinado**

Sobrescreva `preference/__tests__/route.unit.spec.ts` inteiro (resolvendo o conflito) com:

```ts
import { MercadoPagoConfig, Preference } from "mercadopago"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CHECKOUT_MODULE } from "../../../../../modules/checkout"

jest.mock("mercadopago")
jest.mock("crypto", () => ({ randomUUID: () => "fixed-uuid-1234" }))

const MockPreference = Preference as jest.MockedClass<typeof Preference>

import { POST } from "../route"

const makeReq = (
  body: unknown,
  env: Record<string, string> = {},
  sellerByProductId: Record<string, string> = { "prod-1": "seller-1" },
  checkoutServiceOverrides: Record<string, unknown> = {}
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
  const mockCheckoutService = {
    recordSnapshot: jest.fn().mockResolvedValue(undefined),
    attachPreferenceId: jest.fn().mockResolvedValue(undefined),
    ...checkoutServiceOverrides,
  }
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        if (key === CHECKOUT_MODULE) return mockCheckoutService
        if (key === "logger") return mockLogger
        throw new Error(`Unexpected resolve: ${key}`)
      },
    },
    _graph: graph,
    _checkoutService: mockCheckoutService,
    _logger: mockLogger,
  } as any
}

const makeRes = () => {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

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

describe("POST /store/checkout/preference", () => {
  let mockPreferenceCreate: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockPreferenceCreate = jest.fn()
    MockPreference.mockImplementation(() => ({ create: mockPreferenceCreate } as any))
    ;(MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>).mockImplementation(() => ({} as any))
  })

  it("returns preference_id and URLs for a valid request", async () => {
    mockPreferenceCreate.mockResolvedValue({
      id: "pref-abc",
      init_point: "https://mp.com/pay",
      sandbox_init_point: "https://sandbox.mp.com/pay",
    })

    const res = makeRes()
    await POST(makeReq(validBody), res)

    expect(res._status).toBe(200)
    expect(res._body).toEqual({
      preference_id: "pref-abc",
      init_point: "https://mp.com/pay",
      sandbox_init_point: "https://sandbox.mp.com/pay",
      external_reference: "fixed-uuid-1234",
    })
  })

  it("converts item prices from cents to reais", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    const itemPrices = body.items.map((i: any) => i.unit_price)
    expect(itemPrices).toContain(79)
    expect(itemPrices).toContain(25)
  })

  it("includes shipping as a separate item when price > 0", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    const shippingItem = body.items.find((i: any) => i.id.startsWith("frete-"))
    expect(shippingItem).toBeDefined()
    expect(shippingItem.unit_price).toBe(25)
  })

  it("omits shipping item when price is 0", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const body = { ...validBody, shipping: { id: "retirada", name: "Retirada", price: 0 } }
    await POST(makeReq(body), makeRes())

    const reqBody = mockPreferenceCreate.mock.calls[0][0].body
    const shippingItem = reqBody.items.find((i: any) => i.id.startsWith("frete-"))
    expect(shippingItem).toBeUndefined()
  })

  it("omits auto_return when STORE_CORS is HTTP", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody, { STORE_CORS: "http://localhost:3000" }), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.auto_return).toBeUndefined()
  })

  it("sets auto_return when STORE_CORS is HTTPS", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody, { STORE_CORS: "https://mercadopreto.com.br" }), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.auto_return).toBe("approved")
  })

  it("includes notification_url when BACKEND_URL is set", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(
      makeReq(validBody, { BACKEND_URL: "https://abc.ngrok.io" }),
      makeRes()
    )

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.notification_url).toBe("https://abc.ngrok.io/webhooks/mercadopago")
  })

  it("returns 400 when body fails schema validation", async () => {
    const res = makeRes()
    await POST(makeReq({ items: [] }), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
  })

  it("returns 400 when items is an empty array (even with all other fields valid)", async () => {
    const res = makeRes()
    await POST(makeReq({ ...validBody, items: [] }), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
  })

  it("returns 400 when document is missing", async () => {
    const { document, ...bodyWithoutDocument } = validBody
    const res = makeRes()
    await POST(makeReq(bodyWithoutDocument), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
  })

  it("returns 400 when document fails check-digit validation", async () => {
    const res = makeRes()
    await POST(makeReq({ ...validBody, document: "111.444.777-36" }), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
  })

  it("accepts a valid CNPJ as document", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const res = makeRes()
    await POST(makeReq({ ...validBody, document: "11.222.333/0001-81" }), res)

    expect(res._status).toBe(200)
  })

  it("includes buyer_document (clean digits) in the preference metadata", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.metadata.buyer_document).toBe("11144477735")
  })

  it("returns 503 when MERCADOPAGO_ACCESS_TOKEN is not set", async () => {
    const res = makeRes()
    await POST(makeReq(validBody, { MERCADOPAGO_ACCESS_TOKEN: "" }), res)

    expect(res._status).toBe(503)
  })

  it("returns 500 when the MP SDK throws", async () => {
    mockPreferenceCreate.mockRejectedValue(new Error("MP unavailable"))

    const res = makeRes()
    await POST(makeReq(validBody), res)

    expect(res._status).toBe(500)
    expect((res._body as any).detail).toBe("MP unavailable")
  })

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

  it("writes a checkout snapshot (with seller_groups) keyed by the generated external_reference before creating the preference", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const req = makeReq(validBody)
    await POST(req, makeRes())

    expect(req._checkoutService.recordSnapshot).toHaveBeenCalledWith(
      "fixed-uuid-1234",
      expect.objectContaining({
        seller_groups: expect.arrayContaining([expect.objectContaining({ sellerId: "seller-1" })]),
        buyer_document: "11144477735",
        items: [expect.objectContaining({ title: "Camiseta", quantity: 1, price: 7900 })],
        shipping: { id: "pac", name: "PAC", price: 2500 },
        total: 10400,
      })
    )
    const recordCallOrder = req._checkoutService.recordSnapshot.mock.invocationCallOrder[0]
    const createCallOrder = mockPreferenceCreate.mock.invocationCallOrder[0]
    expect(recordCallOrder).toBeLessThan(createCallOrder)
  })

  it("returns 500 and does not call MercadoPago when the snapshot write fails", async () => {
    const req = makeReq(validBody, {}, undefined, {
      recordSnapshot: jest.fn().mockRejectedValue(new Error("db down")),
    })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(500)
    expect(mockPreferenceCreate).not.toHaveBeenCalled()
  })

  it("attaches the returned preference_id to the snapshot after creation succeeds", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-xyz" })

    const req = makeReq(validBody)
    await POST(req, makeRes())

    expect(req._checkoutService.attachPreferenceId).toHaveBeenCalledWith("fixed-uuid-1234", "pref-xyz")
  })

  it("still responds success when attaching the preference_id to the snapshot fails (best-effort, non-fatal)", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-xyz" })
    const req = makeReq(validBody, {}, undefined, {
      attachPreferenceId: jest.fn().mockRejectedValue(new Error("db down")),
    })

    const res = makeRes()
    await POST(req, res)

    expect(res._status).toBe(200)
    expect(res._body).toEqual(expect.objectContaining({ preference_id: "pref-xyz" }))
  })
})
```

- [ ] **Step 4: Rodar só a suíte da rota de preferência**

```bash
cd packages/medusa-backend/apps/backend
npx jest src/api/store/checkout/preference --selectProjects unit 2>/dev/null || TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/store/checkout/preference --runInBand
```

Expected: todos os testes do arquivo passam (schema, resolução de vendedor, seller_groups, snapshot, attachPreferenceId — sem nenhuma falha).

- [ ] **Step 5: Marcar o arquivo como resolvido (sem commitar ainda)**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts
git add packages/medusa-backend/apps/backend/src/api/store/checkout/preference/__tests__/route.unit.spec.ts
git status
```

Expected: os dois arquivos saem de "both modified" e aparecem em "Changes to be committed"; `webhooks/mercadopago/route.ts` e seu teste continuam em conflito — isso é esperado, é o trabalho da Task 2. **Não rode `git commit` agora** — o merge continua em andamento.

---

## Task 2: Resolver o merge em `webhooks/mercadopago/route.ts` e finalizar o merge commit

**Files:**
- Modify (durante o merge): `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts`
- Modify (durante o merge): `packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `checkoutSnapshotPayload` gravado pela Task 1 — `meta.seller_groups: SellerGroup[]` (opcional, ausente em snapshots legados), `meta.items`, `meta.shipping`, `meta.address`, `meta.buyer_document`. `CheckoutModuleService.findByExternalReference(externalReference: string): Promise<{ payload: Record<string, any> } | null>`.
- Produces: nada consumido por tasks futuras — esta é a última mudança de código do plano.

Este arquivo já está em conflito de merge (continuação da Task 1, mesmo merge em andamento — `git status` deve mostrar `preference/route.ts` já resolvido/staged e este par ainda em `both modified`). **Não rode `git merge --abort`.**

- [ ] **Step 1: Confirmar o estado do merge em andamento**

```bash
git status
```

Expected: `MERGE_HEAD` presente (merge em andamento), `preference/route.ts` e seu teste já em "Changes to be committed" (da Task 1), `webhooks/mercadopago/route.ts` e `.../mercadopago/__tests__/route.unit.spec.ts` listados em "both modified" (Unmerged paths).

- [ ] **Step 2: Substituir `webhooks/mercadopago/route.ts` pelo conteúdo combinado**

Sobrescreva o arquivo inteiro (resolvendo o conflito) com:

```ts
import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Payment, Preference } from "mercadopago"
import type { SellerGroup } from "../../../utils/seller-order-groups"
import { CHECKOUT_MODULE } from "../../../modules/checkout"
import type CheckoutModuleService from "../../../modules/checkout/service"

type MPWebhookBody = {
  type?: string
  action?: string
  data?: { id?: string }
}

/**
 * Signature spec (MercadoPago docs): dataId comes from the `data.id` query
 * param (not the body), lowercased, and any part whose value is absent is
 * omitted entirely from the manifest — not left as an empty segment.
 * Returns the parsed manifest for logging purposes.
 */
function buildManifest(
  xSignature: string,
  xRequestId: string | undefined,
  dataId: string,
): { ts: string; v1: string; message: string } | null {
  const parts = Object.fromEntries(
    xSignature.split(",").flatMap((part) => {
      const [k, ...v] = part.trim().split("=")
      return k ? [[k, v.join("=")]] : []
    })
  )
  const ts = parts["ts"]
  const v1 = parts["v1"]

  if (!ts || !v1) return null

  const manifestParts: string[] = []
  if (dataId) manifestParts.push(`id:${dataId}`)
  if (xRequestId) manifestParts.push(`request-id:${xRequestId}`)
  manifestParts.push(`ts:${ts}`)
  const message = manifestParts.join(";") + ";"

  return { ts, v1, message }
}

function verifySignature(req: MedusaRequest, secret: string): { ok: boolean; reason?: string } {
  const xSignature = req.headers["x-signature"] as string | undefined
  const xRequestId = req.headers["x-request-id"] as string | undefined

  if (!xSignature) return { ok: false, reason: "x-signature absent" }

  const dataId = String(req.query?.["data.id"] ?? "").toLowerCase()
  const parsed = buildManifest(xSignature, xRequestId, dataId)

  if (!parsed) return { ok: false, reason: "malformed x-signature (missing ts or v1)" }

  const { ts, v1, message } = parsed
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex")

  try {
    const timingOk = crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"))
    return timingOk ? { ok: true } : { ok: false, reason: `v1 mismatch (got ${v1.slice(0, 8)}...)` }
  } catch {
    return { ok: false, reason: "timingSafeEqual error" }
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN

  if (!webhookSecret) {
    logger.error("[mercadopago/webhook] MERCADOPAGO_WEBHOOK_SECRET não configurado — webhook rejeitado")
    return res.status(500).json({ error: "Webhook secret not configured" })
  }

  const xSignature = req.headers["x-signature"] as string | undefined
  const xRequestId = req.headers["x-request-id"] as string | undefined
  const dataId = String(req.query?.["data.id"] ?? "").toLowerCase()

  logger.info(`[mercadopago/webhook] x-signature: ${xSignature ?? "ausente"}`)
  logger.info(`[mercadopago/webhook] x-request-id: ${xRequestId ?? "ausente"}`)
  logger.info(`[mercadopago/webhook] data.id: ${dataId}`)

  const parsed = buildManifest(xSignature ?? "", xRequestId, dataId)
  if (parsed) {
    const expected = crypto.createHmac("sha256", webhookSecret).update(parsed.message).digest("hex")
    logger.info(`[mercadopago/webhook] manifest: ${parsed.message}`)
    logger.info(`[mercadopago/webhook] expected v1: ${expected}`)
    logger.info(`[mercadopago/webhook] received v1: ${parsed.v1}`)
  }

  const result = verifySignature(req, webhookSecret)
  if (!result.ok) {
    logger.warn(`[mercadopago/webhook] assinatura inválida — ${result.reason}`)
    return res.sendStatus(401)
  }

  const body = req.body as MPWebhookBody
  const isPaymentNotification =
    body.type === "payment" || body.action?.startsWith("payment")

  if (!isPaymentNotification) {
    return res.sendStatus(200)
  }

  const paymentId = body.data?.id
  if (!paymentId || !accessToken) return res.sendStatus(200)

  try {
    const mp = new MercadoPagoConfig({ accessToken })
    const paymentClient = new Payment(mp)
    const payment = await paymentClient.get({ id: Number(paymentId) })

    logger.info(
      `[mercadopago/webhook] payment ${payment.id} | status: ${payment.status} | ref: ${payment.external_reference}`
    )

    if (payment.status === "approved") {
      logger.info(
        `[mercadopago/webhook] pagamento aprovado — R$ ${payment.transaction_amount} | ref: ${payment.external_reference}`
      )

      // MP does not propagate preference.metadata to the payment object.
      // Recupera o snapshot do checkout: prioriza nosso próprio banco (gravado
      // no momento da criação da preferência, sempre disponível de imediato)
      // em vez de depender da busca de preferências do MercadoPago, que foi
      // observada com atraso de indexação de horas (ver
      // docs/superpowers/specs/2026-08-29-checkout-metadata-persistence-design.md).
      let meta = payment.metadata as Record<string, any> | undefined
      if ((!meta?.items?.length) && payment.external_reference) {
        const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)
        let snapshot: any = null
        try {
          snapshot = await checkoutService.findByExternalReference(payment.external_reference)
        } catch (snapshotErr) {
          logger.warn(`[mercadopago/webhook] falha ao consultar snapshot local: ${snapshotErr}`)
        }
        if (snapshot) {
          meta = snapshot.payload as Record<string, any>
          logger.info(`[mercadopago/webhook] metadados recuperados do snapshot local para ref ${payment.external_reference}`)
        } else {
          // Fallback legado: preferências criadas antes deste snapshot existir
          // (ou consulta ao snapshot local falhou — ver warning acima).
          try {
            const prefClient = new Preference(mp)
            const searchResult = await prefClient.search({
              options: { external_reference: payment.external_reference },
            })
            const prefId = searchResult.elements?.[0]?.id
            if (prefId) {
              const pref = await prefClient.get({ preferenceId: prefId })
              meta = pref.metadata as Record<string, any> | undefined
              logger.info(`[mercadopago/webhook] metadados recuperados da preferência ${prefId} (fallback legado)`)
            }
          } catch (prefErr) {
            logger.warn(`[mercadopago/webhook] falha ao buscar preferência (fallback legado): ${prefErr}`)
          }
        }
      }

      const addr = meta?.address as Record<string, string> | undefined
      const shipping: { name: string; price: number } | undefined = meta?.shipping

      if (!meta?.items?.length) {
        logger.error(
          `[mercadopago/webhook] metadados do checkout não recuperados (payment.metadata vazio, snapshot ausente, busca de preferência sem resultado) — pedido NÃO criado pra ref ${payment.external_reference}, payment ${payment.id}`
        )
        return res.sendStatus(200)
      }

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
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error("[mercadopago/webhook] erro ao processar notificação:", err)
    // Retornar 200 para evitar retentativas do MP em erros não-recuperáveis
    res.sendStatus(200)
  }
}
```

- [ ] **Step 3: Substituir o teste pelo conteúdo combinado**

Sobrescreva `webhooks/mercadopago/__tests__/route.unit.spec.ts` inteiro (resolvendo o conflito) com:

```ts
import { MercadoPagoConfig, Payment, Preference } from "mercadopago"

jest.mock("mercadopago")
jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto")
  return { ...actual, randomUUID: () => "fixed-uuid" }
})

const MockPayment = Payment as jest.MockedClass<typeof Payment>
const MockPreference = Preference as jest.MockedClass<typeof Preference>
;(MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>).mockImplementation(() => ({} as any))

import { POST } from "../route"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_TEST_SECRET = "test-secret"

// Mirrors the official signature spec: dataId comes from the query string
// (lowercased), and any part whose value is absent is omitted entirely.
function makeValidSignature(dataId: string, secret: string, requestId: string | undefined = "test-request-id") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto")
  const ts = "1000000000"
  const parts: string[] = []
  if (dataId) parts.push(`id:${dataId.toLowerCase()}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${ts}`)
  const message = parts.join(";") + ";"
  const v1 = crypto.createHmac("sha256", secret).update(message).digest("hex")
  const headers: Record<string, string> = { "x-signature": `ts=${ts},v1=${v1}` }
  if (requestId) headers["x-request-id"] = requestId
  return headers
}

function makeReq(body: unknown, secret = WEBHOOK_TEST_SECRET) {
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret

  const mockOrderService = {
    createOrders: jest.fn().mockResolvedValue([{ id: "order-1" }]),
    listOrders: jest.fn().mockResolvedValue([]),
  }
  const mockEventBusService = {
    emit: jest.fn().mockResolvedValue(undefined),
  }
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  const mockCheckoutService = {
    findByExternalReference: jest.fn().mockResolvedValue(null),
  }

  const dataId = (body as any)?.data?.id ?? ""

  return {
    body,
    query: { "data.id": dataId },
    headers: secret ? makeValidSignature(dataId, secret) : {},
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return mockLogger
        if (key === "checkout") return mockCheckoutService
        if (key.includes("order")) return mockOrderService
        if (key.includes("event")) return mockEventBusService
        return {}
      },
    },
    _orderService: mockOrderService,
    _eventBusService: mockEventBusService,
    _checkoutService: mockCheckoutService,
  } as any
}

function makeRes() {
  const res = { _status: 200 } as any
  res.sendStatus = (code: number) => { res._status = code; return res }
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const approvedPayment = {
  id: 42,
  status: "approved",
  transaction_amount: 79,
  external_reference: "ext-ref-uuid",
  metadata: {},
  payer: { email: "buyer@test.com", name: "João", surname: "Silva", phone: {}, address: {} },
}

const preferenceMetadata = {
  address: {
    first_name: "João",
    last_name: "Silva",
    email: "buyer@test.com",
    phone: "71999990000",
    address_1: "Rua das Flores",
    address_2: "100",
    city: "Cachoeira",
    state: "BA",
    postal_code: "44300000",
  },
  items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }],
  shipping: { id: "pac", name: "PAC", price: 1500 },
  total: 9400,
  seller_id: "seller-abc",
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /webhooks/mercadopago", () => {
  let mockPaymentGet: jest.Mock
  let mockPrefSearch: jest.Mock
  let mockPrefGet: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockPaymentGet = jest.fn()
    mockPrefSearch = jest.fn()
    mockPrefGet = jest.fn()

    MockPayment.mockImplementation(() => ({ get: mockPaymentGet } as any))
    MockPreference.mockImplementation(() => ({ search: mockPrefSearch, get: mockPrefGet } as any))
  })

  it("returns 200 without creating order for non-payment notification", async () => {
    const req = makeReq({ type: "subscription", data: { id: "1" } })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("returns 200 without creating order when payment is not approved", async () => {
    mockPaymentGet.mockResolvedValue({ ...approvedPayment, status: "pending" })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("creates order using preference metadata when payment.metadata has no items", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(mockPrefSearch).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ external_reference: "ext-ref-uuid" }) })
    )
    expect(mockPrefGet).toHaveBeenCalledWith({ preferenceId: "pref-123" })
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: [expect.objectContaining({ title: "Camiseta", quantity: 1, unit_price: 7900 })],
        }),
      ])
    )
  })

  it("uses payment.metadata directly when it already has items", async () => {
    const paymentWithItems = {
      ...approvedPayment,
      metadata: preferenceMetadata,
    }
    mockPaymentGet.mockResolvedValue(paymentWithItems)

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(mockPrefSearch).not.toHaveBeenCalled()
    expect(req._checkoutService.findByExternalReference).not.toHaveBeenCalled()
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: [expect.objectContaining({ unit_price: 7900 })],
        }),
      ])
    )
  })

  it("creates order using the local checkout snapshot when payment.metadata has no items (does not call MercadoPago's preference search)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._checkoutService.findByExternalReference.mockResolvedValue({ payload: preferenceMetadata })

    await POST(req, makeRes())

    expect(mockPrefSearch).not.toHaveBeenCalled()
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: [expect.objectContaining({ title: "Camiseta", quantity: 1, unit_price: 7900 })],
        }),
      ])
    )
  })

  it("falls through to the legacy MercadoPago preference search when the local snapshot lookup throws (non-fatal)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._checkoutService.findByExternalReference.mockRejectedValue(new Error("db down"))

    await POST(req, makeRes())

    expect(mockPrefSearch).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ external_reference: "ext-ref-uuid" }) })
    )
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: [expect.objectContaining({ title: "Camiseta", quantity: 1, unit_price: 7900 })],
        }),
      ])
    )
  })

  it("stores unit_price in centavos (no /100 conversion)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrder] = req._orderService.createOrders.mock.calls[0][0]
    expect(createdOrder.items[0].unit_price).toBe(7900)
    expect(createdOrder.items[0].unit_price).not.toBe(79)
  })

  it("stores shipping amount in centavos (no /100 conversion)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrder] = req._orderService.createOrders.mock.calls[0][0]
    expect(createdOrder.shipping_methods[0].amount).toBe(1500)
    expect(createdOrder.shipping_methods[0].amount).not.toBe(15)
  })

  it("propagates seller_id from preference metadata into the created order's metadata", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrder] = req._orderService.createOrders.mock.calls[0][0]
    expect(createdOrder.metadata.seller_id).toBe("seller-abc")
  })

  it("does not create an order when metadata recovery fails via preference search error (refuses instead of creating an empty order)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockRejectedValue(new Error("MP unavailable"))

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()
    await POST(req, res)

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })

  it("does not create an order when preference search returns no results (refuses instead of creating an empty order)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [] })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()
    await POST(req, res)

    expect(mockPrefGet).not.toHaveBeenCalled()
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })

  it("emits order.placed and mercadopago.order_approved after order creation", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(req._eventBusService.emit).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "order.placed", data: { id: "order-1" } }),
        expect.objectContaining({ name: "mercadopago.order_approved", data: { id: "order-1" } }),
      ])
    )
  })

  it("returns 200 even when an unexpected error occurs", async () => {
    mockPaymentGet.mockRejectedValue(new Error("network error"))

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
  })

  it("returns 401 when signature verification fails", async () => {
    const req = makeReq({ type: "payment", data: { id: "42" } }, "my-secret")
    req.headers = { "x-signature": "ts=123,v1=invalidsig", "x-request-id": "req-1" }
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(401)
  })

  it("validates signature when x-request-id is absent (manifest omits the segment, doesn't leave it empty)", async () => {
    mockPaymentGet.mockResolvedValue({ ...approvedPayment, status: "pending" })

    const body = { type: "payment", data: { id: "42" } }
    const req = makeReq(body, "my-secret")
    req.headers = makeValidSignature("42", "my-secret", undefined)
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
  })

  it("rejects a signature computed with the old (buggy) always-include-request-id manifest", async () => {
    // Regression guard: id:42;request-id:;ts:...; (old bug) must NOT validate
    // against the correct manifest id:42;ts:...; (request-id omitted).
    const crypto = require("crypto") as typeof import("crypto")
    const ts = "1000000000"
    const buggyMessage = `id:42;request-id:;ts:${ts};`
    const v1 = crypto.createHmac("sha256", "my-secret").update(buggyMessage).digest("hex")

    const req = makeReq({ type: "payment", data: { id: "42" } }, "my-secret")
    req.headers = { "x-signature": `ts=${ts},v1=${v1}` }
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(401)
  })

  const twoSellerGroupsMetadata = {
    address: preferenceMetadata.address,
    // Flat items list — sempre presente junto de seller_groups num checkoutSnapshotPayload
    // real (Task 1), é o que o guard de "nada recuperado" do webhook verifica.
    items: [
      { variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7500 },
      { variant_id: "var-2", title: "Sabonete", quantity: 1, price: 2500 },
    ],
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

  it("creates one order per seller group when seller_groups is present via the legacy preference-search fallback", async () => {
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

  it("creates one order per seller group when the local checkout snapshot contains seller_groups (does not call MercadoPago's preference search)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._checkoutService.findByExternalReference.mockResolvedValue({ payload: twoSellerGroupsMetadata })
    req._orderService.createOrders.mockResolvedValue([{ id: "order-a" }, { id: "order-b" }])

    await POST(req, makeRes())

    expect(mockPrefSearch).not.toHaveBeenCalled()
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders).toHaveLength(2)
    expect(createdOrders.map((o: any) => o.metadata.seller_id).sort()).toEqual(["seller-a", "seller-b"])
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
})
```

> **Nota para quem revisar:** os dois testes antigos "creates order with empty items when preference fetch fails" e "...when preference search returns no results" (do arquivo original da branch de split) foram **substituídos**, não mantidos junto dos novos — o comportamento antigo (criar pedido vazio) é exatamente o que esta reconciliação corrige. Os testes novos "does not create an order when metadata recovery fails..." e "...when preference search returns no results (refuses...)" cobrem o mesmo cenário de entrada com a asserção correta.

- [ ] **Step 4: Rodar a suíte inteira do backend**

```bash
cd packages/medusa-backend/apps/backend
npm run test:unit
```

Expected: `42 passed, 42 total` suítes, todos os testes verdes — nenhuma falha, nenhum teste pulado.

- [ ] **Step 5: Finalizar o merge commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/route.ts
git add packages/medusa-backend/apps/backend/src/api/webhooks/mercadopago/__tests__/route.unit.spec.ts
git status  # confirmar que não sobrou nenhum "Unmerged paths"
git commit -m "$(cat <<'EOF'
merge: reconcilia split por vendedor com persistência de snapshot do checkout

Combina fix/checkout-metadata-persistence em fix/multi-seller-cart-order-split:
checkoutSnapshotPayload passa a carregar seller_groups (em vez de seller_id
solto), e o webhook de pagamento aprovado passa a ler o snapshot local do
checkout primeiro (com fallback pra busca legada de preferência no
MercadoPago) antes de derivar os seller_groups e criar os N pedidos.

Ver docs/superpowers/specs/2026-09-03-checkout-metadata-seller-groups-reconciliation-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAcLs8YASQVKLrNCikxSmt
EOF
)"
```

Expected: commit de merge criado com sucesso (2 parents), `git status` limpo.

---

## Task 3: Regressão final, limpeza da branch de origem e atualização de documentação

**Files:**
- Modify: `HANDOFF.md`
- Modify: `.superpowers/sdd/2026-08-27-multi-seller-cart-order-split/progress.md` (ledger, não versionado em git — ver Task 2 do ledger original)
- Delete: branch `fix/checkout-metadata-persistence` e worktree `.worktrees/fix-checkout-metadata-persistence`

**Interfaces:**
- Consumes: nada de tasks futuras (última task do plano).
- Produces: nada — task de encerramento.

- [ ] **Step 1: Rodar a suíte completa do backend de novo (pós-merge-commit)**

```bash
cd packages/medusa-backend/apps/backend
npm run test:unit
```

Expected: `42 passed, 42 total`, sem regressão.

- [ ] **Step 2: Rodar a suíte do storefront**

```bash
cd apps/storefront
npm test
```

Expected: todos os arquivos de teste passam, sem regressão (o storefront não foi tocado pelo merge — este é só um regression check).

- [ ] **Step 3: Apagar a branch e o worktree de origem**

Voltando pra raiz do repo (`/home/lupontes/repos/marketplace`):

```bash
git worktree remove .worktrees/fix-checkout-metadata-persistence
git branch -d fix/checkout-metadata-persistence
```

Expected: `git branch -d` aceita a exclusão sem `--force` (a branch está totalmente contida no merge commit da Task 2, `git` reconhece isso automaticamente). Se recusar com "not fully merged", **pare e reporte** — não use `-D`, isso indica que o merge não foi feito corretamente.

- [ ] **Step 4: Atualizar `HANDOFF.md`**

Editar a seção "Not Yet Done" e "Current State" de `HANDOFF.md` (na raiz do repo) pra registrar: reconciliação feita via merge commit (citar o hash do commit da Task 2), branch `fix/checkout-metadata-persistence` apagada, próximo passo volta a ser o reteste manual do split multi-vendedor (Task 5 original) — agora rodando contra o código combinado. Não precisa reescrever o arquivo inteiro — só a seção relevante.

- [ ] **Step 5: Commit da atualização de documentação**

```bash
git add HANDOFF.md
git commit -m "$(cat <<'EOF'
docs(checkout): atualiza handoff após reconciliação split-vendedor + persistência de snapshot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAcLs8YASQVKLrNCikxSmt
EOF
)"
```

Expected: commit criado, `git log --oneline -5` mostra o merge commit da Task 2 seguido deste commit de docs.
