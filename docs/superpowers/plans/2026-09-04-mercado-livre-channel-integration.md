# Integração com Mercado Livre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender produtos curados dos vendedores do Mercado Preto também no Mercado Livre, através de uma única conta ML de propriedade do Mercado Preto, com os pedidos entrando no mesmo pipeline de comissão/repasse/NF-e já existente.

**Architecture:** Novo módulo `marketplace-channel` (padrão dos módulos já existentes) guarda anúncios publicados e a credencial OAuth da conta ML. Pedidos do ML entram por um webhook próprio, criam um `Order` padrão do Medusa e emitem um evento novo (`marketplace.order_placed`) que os subscribers de comissão/NF-e/WhatsApp já existentes passam a escutar, ao lado do evento do MercadoPago — sem duplicar lógica.

**Tech Stack:** Medusa v2, TypeScript, Zod, Jest, API REST do Mercado Livre (OAuth2).

**Spec:** `docs/superpowers/specs/2026-09-04-mercado-livre-channel-integration-design.md`

## Global Constraints

- **Pré-requisito não-técnico:** validação jurídica/contábil do modelo (conta única, CNPJ único intermediando tudo) antes de qualquer publicação real de produto ou processamento de pagamento real — nenhuma task deste plano depende disso pra ser implementada/testada, mas o deploy em produção depende.
- Conta ML é única, de propriedade do Mercado Preto — não existe fluxo de OAuth por vendedor.
- Mapeamento de categoria/atributo do ML é manual (admin escolhe), nunca automático.
- Só produtos de variante única nesta primeira versão.
- Frete só via Mercado Envios (`shipping.mode: "me2"`).
- Taxa de venda do ML nunca é um número fixo hardcoded — sempre resolvida via a API `listing_prices` no momento da publicação e armazenada por anúncio, nunca uma tabela estática no código (o percentual varia por categoria e o próprio ML muda esses valores).
- Migrations são SQL puro, hand-written, seguindo o padrão dos módulos `commission`/`fiscal`/`payout`/`checkout` (nunca `medusa db:generate`).
- Mensagens de commit em português, Conventional Commits, imperativo, minúsculo, sem ponto final.

---

## Task 1: Módulo `marketplace-channel`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/modules/marketplace-channel/models/channel-listing.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/marketplace-channel/models/channel-credential.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/marketplace-channel/service.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/marketplace-channel/index.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/marketplace-channel/migrations/Migration20260904120000.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/marketplace-channel/__tests__/service.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/medusa-config.ts`

**Interfaces:**
- Produces: `MARKETPLACE_CHANNEL_MODULE` (string `"marketplace_channel"`); `MarketplaceChannelModuleService` com métodos `recordListing(input)`, `recordListingError(productId, sellerId, channel, errorMessage)`, `findListingByExternalItemId(externalItemId): Promise<{id, productId, sellerId, channel, externalItemId, saleFeePercent, saleFeeFixed, status} | null>`, `getCredential(channel): Promise<{id, channel, accessToken, refreshToken, expiresAt} | null>`, `saveCredential(channel, accessToken, refreshToken, expiresAt)`. Todas as tasks seguintes consomem esse service pelo `MARKETPLACE_CHANNEL_MODULE`.

- [ ] **Step 1: Escrever os models**

`models/channel-listing.ts`:
```ts
import { model } from "@medusajs/framework/utils"

const ChannelListing = model.define("channel_listing", {
  id: model.id().primaryKey(),
  productId: model.text(),
  sellerId: model.text(),
  channel: model.enum(["mercado_livre"]),
  externalItemId: model.text().nullable(),
  externalCategoryId: model.text().nullable(),
  saleFeePercent: model.float().nullable(),
  saleFeeFixed: model.float().nullable(),
  status: model.enum(["draft", "published", "paused", "error"]).default("draft"),
  lastError: model.text().nullable(),
})

export default ChannelListing
```

`models/channel-credential.ts`:
```ts
import { model } from "@medusajs/framework/utils"

const ChannelCredential = model.define("channel_credential", {
  id: model.id().primaryKey(),
  channel: model.enum(["mercado_livre"]),
  accessToken: model.text(),
  refreshToken: model.text(),
  expiresAt: model.dateTime(),
})

export default ChannelCredential
```

- [ ] **Step 2: Escrever o teste do service (RED)**

`__tests__/service.unit.spec.ts`:
```ts
jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        createChannelListings = jest.fn()
        listChannelListings = jest.fn()
        updateChannelListings = jest.fn()
        createChannelCredentials = jest.fn()
        listChannelCredentials = jest.fn()
        updateChannelCredentials = jest.fn()
      },
  }
})

import MarketplaceChannelModuleService from "../service"

function makeService() {
  return new MarketplaceChannelModuleService() as any
}

describe("MarketplaceChannelModuleService", () => {
  describe("recordListing", () => {
    it("creates a channel_listing with status published", async () => {
      const svc = makeService()
      svc.createChannelListings.mockResolvedValue({ id: "cl_1" })

      await svc.recordListing({
        productId: "prod_1",
        sellerId: "seller_1",
        channel: "mercado_livre",
        externalItemId: "MLB123",
        externalCategoryId: "MLB1000",
        saleFeePercent: 12,
        saleFeeFixed: 5,
      })

      expect(svc.createChannelListings).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: "prod_1",
          sellerId: "seller_1",
          externalItemId: "MLB123",
          status: "published",
        })
      )
    })
  })

  describe("recordListingError", () => {
    it("creates a channel_listing with status error and the error message", async () => {
      const svc = makeService()
      svc.createChannelListings.mockResolvedValue({ id: "cl_1" })

      await svc.recordListingError("prod_1", "seller_1", "mercado_livre", "categoria inválida")

      expect(svc.createChannelListings).toHaveBeenCalledWith(
        expect.objectContaining({ productId: "prod_1", sellerId: "seller_1", status: "error", lastError: "categoria inválida" })
      )
    })
  })

  describe("findListingByExternalItemId", () => {
    it("returns the listing when found", async () => {
      const svc = makeService()
      svc.listChannelListings.mockResolvedValue([{ id: "cl_1", externalItemId: "MLB123" }])

      const result = await svc.findListingByExternalItemId("MLB123")

      expect(svc.listChannelListings).toHaveBeenCalledWith({ externalItemId: "MLB123" })
      expect(result).toEqual({ id: "cl_1", externalItemId: "MLB123" })
    })

    it("returns null when not found", async () => {
      const svc = makeService()
      svc.listChannelListings.mockResolvedValue([])

      const result = await svc.findListingByExternalItemId("MLB999")

      expect(result).toBeNull()
    })
  })

  describe("getCredential / saveCredential", () => {
    it("creates a new credential when none exists", async () => {
      const svc = makeService()
      svc.listChannelCredentials.mockResolvedValue([])
      const expiresAt = new Date("2026-09-04T12:00:00.000Z")

      await svc.saveCredential("mercado_livre", "token-abc", "refresh-xyz", expiresAt)

      expect(svc.createChannelCredentials).toHaveBeenCalledWith({
        channel: "mercado_livre",
        accessToken: "token-abc",
        refreshToken: "refresh-xyz",
        expiresAt,
      })
      expect(svc.updateChannelCredentials).not.toHaveBeenCalled()
    })

    it("updates the existing credential when one already exists", async () => {
      const svc = makeService()
      svc.listChannelCredentials.mockResolvedValue([{ id: "cc_1", channel: "mercado_livre" }])
      const expiresAt = new Date("2026-09-04T12:00:00.000Z")

      await svc.saveCredential("mercado_livre", "token-new", "refresh-new", expiresAt)

      expect(svc.updateChannelCredentials).toHaveBeenCalledWith({
        id: "cc_1",
        accessToken: "token-new",
        refreshToken: "refresh-new",
        expiresAt,
      })
      expect(svc.createChannelCredentials).not.toHaveBeenCalled()
    })
  })
})
```

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/marketplace-channel --runInBand`
Expected: FAIL — `../service` não existe ainda.

- [ ] **Step 3: Implementar o service**

`service.ts`:
```ts
import { MedusaService } from "@medusajs/framework/utils"
import ChannelListing from "./models/channel-listing"
import ChannelCredential from "./models/channel-credential"

type RecordListingInput = {
  productId: string
  sellerId: string
  channel: string
  externalItemId: string
  externalCategoryId: string
  saleFeePercent: number
  saleFeeFixed: number
}

class MarketplaceChannelModuleService extends MedusaService({ ChannelListing, ChannelCredential }) {
  async recordListing(input: RecordListingInput) {
    return this.createChannelListings({ ...input, status: "published" } as any)
  }

  async recordListingError(productId: string, sellerId: string, channel: string, errorMessage: string) {
    return this.createChannelListings({ productId, sellerId, channel, status: "error", lastError: errorMessage } as any)
  }

  async findListingByExternalItemId(externalItemId: string): Promise<any | null> {
    const [listing] = await this.listChannelListings({ externalItemId } as any)
    return listing ?? null
  }

  async getCredential(channel: string): Promise<any | null> {
    const [credential] = await this.listChannelCredentials({ channel } as any)
    return credential ?? null
  }

  async saveCredential(channel: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
    const existing = await this.getCredential(channel)
    if (existing) {
      await this.updateChannelCredentials({ id: existing.id, accessToken, refreshToken, expiresAt } as any)
    } else {
      await this.createChannelCredentials({ channel, accessToken, refreshToken, expiresAt } as any)
    }
  }
}

export default MarketplaceChannelModuleService
```

`index.ts`:
```ts
import { Module } from "@medusajs/framework/utils"
import MarketplaceChannelModuleService from "./service"

export const MARKETPLACE_CHANNEL_MODULE = "marketplace_channel"

export default Module(MARKETPLACE_CHANNEL_MODULE, {
  service: MarketplaceChannelModuleService,
})
```

`migrations/Migration20260904120000.ts`:
```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260904120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "channel_listing" ("id" text not null, "productId" text not null, "sellerId" text not null, "channel" text check ("channel" in ('mercado_livre')) not null, "externalItemId" text null, "externalCategoryId" text null, "saleFeePercent" real null, "saleFeeFixed" real null, "status" text check ("status" in ('draft', 'published', 'paused', 'error')) not null default 'draft', "lastError" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "channel_listing_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_listing_deleted_at" ON "channel_listing" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_channel_listing_external_item_id_unique" ON "channel_listing" ("externalItemId") WHERE "externalItemId" IS NOT NULL;`);

    this.addSql(`create table if not exists "channel_credential" ("id" text not null, "channel" text check ("channel" in ('mercado_livre')) not null, "accessToken" text not null, "refreshToken" text not null, "expiresAt" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "channel_credential_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_credential_deleted_at" ON "channel_credential" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_channel_credential_channel_unique" ON "channel_credential" ("channel") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "channel_listing" cascade;`);
    this.addSql(`drop table if exists "channel_credential" cascade;`);
  }

}
```

In `medusa-config.ts`, add to the `modules` array (right after the checkout module entry):
```ts
    // Marketplace channel — publicação de produtos e recebimento de
    // pedidos de canais de venda externos (Mercado Livre)
    {
      resolve: "./src/modules/marketplace-channel",
    },
```

- [ ] **Step 4: Rodar o teste (GREEN)**

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/marketplace-channel --runInBand`
Expected: PASS — 6/6 testes.

- [ ] **Step 5: Rodar a suíte completa e commitar**

```bash
npm run test:unit
git add packages/medusa-backend/apps/backend/src/modules/marketplace-channel packages/medusa-backend/apps/backend/medusa-config.ts
git commit -m "feat(marketplace-channel): adiciona módulo de canais de venda externos"
```

---

## Task 2: Cliente HTTP do Mercado Livre

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/mercadolivre-client.ts`
- Create: `packages/medusa-backend/apps/backend/src/utils/__tests__/mercadolivre-client.unit.spec.ts`

**Interfaces:**
- Consumes: nada de outras tasks — funções puras que recebem `accessToken` como parâmetro, sem resolver credencial sozinhas (mantém testável sem container do Medusa).
- Produces: `refreshAccessToken(refreshToken): Promise<{accessToken, refreshToken, expiresIn}>`, `getListingFee(accessToken, price, categoryId): Promise<{percentageFee, fixedFee}>`, `createItem(accessToken, item: MLItemInput): Promise<{id}>`, `getOrder(accessToken, orderId): Promise<MLOrder>`, `getShipmentLabelUrl(accessToken, shipmentId): string`, `verifyWebhookSignature(params: {xSignature, xRequestId, dataId, secret}): boolean`. Consumidos pelas Tasks 3, 4 e 5.

- [ ] **Step 1: Escrever os testes (RED)**

```ts
import {
  refreshAccessToken,
  getListingFee,
  createItem,
  getOrder,
  getShipmentLabelUrl,
} from "../mercadolivre-client"

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

describe("mercadolivre-client", () => {
  beforeEach(() => {
    process.env.MERCADOLIVRE_CLIENT_ID = "client-123"
    process.env.MERCADOLIVRE_CLIENT_SECRET = "secret-456"
    global.fetch = jest.fn()
  })

  describe("refreshAccessToken", () => {
    it("posts to /oauth/token with grant_type=refresh_token and returns the new tokens", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 21600 })
      )

      const result = await refreshAccessToken("old-refresh")

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.mercadolibre.com/oauth/token",
        expect.objectContaining({ method: "POST" })
      )
      const body = (global.fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams
      expect(body.get("grant_type")).toBe("refresh_token")
      expect(body.get("refresh_token")).toBe("old-refresh")
      expect(body.get("client_id")).toBe("client-123")
      expect(result).toEqual({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 21600 })
    })

    it("throws when the refresh request fails", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}, false, 400))

      await expect(refreshAccessToken("bad-refresh")).rejects.toThrow("400")
    })
  })

  describe("getListingFee", () => {
    it("requests listing_prices with price and category_id, returns percentage and fixed fee", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ sale_fee_details: { percentage_fee: 12.5, fixed_fee: 5 } })
      )

      const result = await getListingFee("token-abc", 7900, "MLB1000")

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.mercadolibre.com/sites/MLB/listing_prices?price=7900&category_id=MLB1000",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-abc" }) })
      )
      expect(result).toEqual({ percentageFee: 12.5, fixedFee: 5 })
    })
  })

  describe("createItem", () => {
    it("posts to /items with shipping.mode me2 and returns the created item id", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: "MLB999888777" }))

      const result = await createItem("token-abc", {
        title: "Bolsa Africana 2 em 1",
        categoryId: "MLB1000",
        price: 182,
        availableQuantity: 1,
        pictures: [{ source: "https://example.com/foto.jpg" }],
        attributes: [{ id: "BRAND", value_name: "Genérica" }],
      })

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe("https://api.mercadolibre.com/items")
      const sentBody = JSON.parse(init.body)
      expect(sentBody.shipping).toEqual({ mode: "me2" })
      expect(sentBody.category_id).toBe("MLB1000")
      expect(result).toEqual({ id: "MLB999888777" })
    })

    it("throws with the response detail when creation fails", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ message: "categoria inválida" }, false, 400)
      )

      await expect(
        createItem("token-abc", {
          title: "X",
          categoryId: "bad",
          price: 10,
          availableQuantity: 1,
          pictures: [],
          attributes: [],
        })
      ).rejects.toThrow("400")
    })
  })

  describe("getOrder", () => {
    it("fetches /orders/:id with the bearer token", async () => {
      const mlOrder = { id: 123, status: "paid", order_items: [] }
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(mlOrder))

      const result = await getOrder("token-abc", "123")

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.mercadolibre.com/orders/123",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-abc" }) })
      )
      expect(result).toEqual(mlOrder)
    })
  })

  describe("getShipmentLabelUrl", () => {
    it("builds the label URL with the shipment id and access token", () => {
      const url = getShipmentLabelUrl("token-abc", "shipment-1")
      expect(url).toBe(
        "https://api.mercadolibre.com/shipment_labels?shipment_ids=shipment-1&response_type=pdf&access_token=token-abc"
      )
    })
  })
})
```

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/utils/__tests__/mercadolivre-client --runInBand`
Expected: FAIL — `../mercadolivre-client` não existe.

- [ ] **Step 2: Implementar o cliente**

```ts
const API_BASE = "https://api.mercadolibre.com"
const SITE_ID = "MLB"

export type MLListingFee = { percentageFee: number; fixedFee: number }

export type MLItemInput = {
  title: string
  categoryId: string
  price: number
  currencyId?: string
  availableQuantity: number
  condition?: "new" | "used"
  listingTypeId?: string
  pictures: { source: string }[]
  attributes: { id: string; value_name: string }[]
}

export type MLOrder = {
  id: number
  status: string
  total_amount?: number
  buyer?: { id: number; nickname: string; billing_info?: { doc_number?: string; doc_type?: string } }
  order_items: Array<{ item: { id: string; title: string }; quantity: number; unit_price: number }>
  shipping?: { id: number }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.MERCADOLIVRE_CLIENT_ID ?? "",
      client_secret: process.env.MERCADOLIVRE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Mercado Livre OAuth refresh falhou: ${res.status}`)
  const data = await res.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in }
}

export async function getListingFee(accessToken: string, price: number, categoryId: string): Promise<MLListingFee> {
  const url = `${API_BASE}/sites/${SITE_ID}/listing_prices?price=${price}&category_id=${categoryId}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Mercado Livre listing_prices falhou: ${res.status}`)
  const data = await res.json()
  const details = data.sale_fee_details ?? {}
  return {
    percentageFee: Number(details.percentage_fee ?? 0),
    fixedFee: Number(details.fixed_fee ?? 0),
  }
}

export async function createItem(accessToken: string, item: MLItemInput): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: item.title,
      category_id: item.categoryId,
      price: item.price,
      currency_id: item.currencyId ?? "BRL",
      available_quantity: item.availableQuantity,
      condition: item.condition ?? "new",
      listing_type_id: item.listingTypeId ?? "gold_special",
      pictures: item.pictures,
      attributes: item.attributes,
      shipping: { mode: "me2" },
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Mercado Livre criação de anúncio falhou (${res.status}): ${detail}`)
  }
  const data = await res.json()
  return { id: data.id }
}

export async function getOrder(accessToken: string, orderId: string): Promise<MLOrder> {
  const res = await fetch(`${API_BASE}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Mercado Livre busca de pedido falhou: ${res.status}`)
  return res.json()
}

export function getShipmentLabelUrl(accessToken: string, shipmentId: string): string {
  return `${API_BASE}/shipment_labels?shipment_ids=${shipmentId}&response_type=pdf&access_token=${accessToken}`
}

// Mesmo esquema de assinatura documentado pelo Mercado Pago para seus
// webhooks (header x-signature: "ts=...,v1=...", manifest HMAC-SHA256
// "id:{id};request-id:{x-request-id};ts:{ts};") — confirmar no painel
// Webhooks da aplicação Mercado Livre, ao gerar o secret real, que o
// formato do manifest é idêntico antes de habilitar em produção.
export function verifyWebhookSignature(params: {
  xSignature: string
  xRequestId: string
  dataId: string
  secret: string
}): boolean {
  const { xSignature, xRequestId, dataId, secret } = params
  const parts: Record<string, string> = {}
  for (const part of xSignature.split(",")) {
    const [key, value] = part.trim().split("=")
    if (key && value) parts[key] = value
  }
  const ts = parts.ts
  const receivedHash = parts.v1
  if (!ts || !receivedHash) return false

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const expectedHash = createHmac("sha256", secret).update(manifest).digest("hex")

  const expectedBuf = Buffer.from(expectedHash, "hex")
  const receivedBuf = Buffer.from(receivedHash, "hex")
  if (expectedBuf.length !== receivedBuf.length) return false
  return timingSafeEqual(expectedBuf, receivedBuf)
}
```

Adicionar no topo do arquivo, junto aos demais imports:
```ts
import { createHmac, timingSafeEqual } from "node:crypto"
```

- [ ] **Step 3: Escrever os testes de `verifyWebhookSignature` (RED)**

Adicionar ao final do arquivo de teste, dentro de um novo `describe`:

```ts
import { createHmac } from "node:crypto"

describe("verifyWebhookSignature", () => {
  function sign(dataId: string, requestId: string, ts: string, secret: string) {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
    return createHmac("sha256", secret).update(manifest).digest("hex")
  }

  it("returns true when the signature matches", () => {
    const secret = "webhook-secret"
    const ts = "1700000000"
    const hash = sign("555", "req-1", ts, secret)

    const result = verifyWebhookSignature({
      xSignature: `ts=${ts},v1=${hash}`,
      xRequestId: "req-1",
      dataId: "555",
      secret,
    })

    expect(result).toBe(true)
  })

  it("returns false when the signature doesn't match", () => {
    const secret = "webhook-secret"
    const ts = "1700000000"
    const hash = sign("555", "req-1", ts, "wrong-secret")

    const result = verifyWebhookSignature({
      xSignature: `ts=${ts},v1=${hash}`,
      xRequestId: "req-1",
      dataId: "555",
      secret,
    })

    expect(result).toBe(false)
  })

  it("returns false when the header is malformed", () => {
    const result = verifyWebhookSignature({
      xSignature: "not-a-valid-header",
      xRequestId: "req-1",
      dataId: "555",
      secret: "webhook-secret",
    })

    expect(result).toBe(false)
  })
})
```

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/utils/__tests__/mercadolivre-client --runInBand`
Expected: FAIL — `verifyWebhookSignature` não existe.

- [ ] **Step 4: Rodar o teste (GREEN)**

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/utils/__tests__/mercadolivre-client --runInBand`
Expected: PASS — 11/11 testes.

- [ ] **Step 5: Rodar a suíte completa e commitar**

```bash
npm run test:unit
git add packages/medusa-backend/apps/backend/src/utils/mercadolivre-client.ts packages/medusa-backend/apps/backend/src/utils/__tests__/mercadolivre-client.unit.spec.ts
git commit -m "feat(marketplace-channel): adiciona cliente HTTP do Mercado Livre"
```

---

## Task 3: Job de renovação de token

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/scripts/mercadolivre-token-refresh.ts`
- Create: `packages/medusa-backend/apps/backend/src/scripts/__tests__/mercadolivre-token-refresh.unit.spec.ts`

**Interfaces:**
- Consumes: `MARKETPLACE_CHANNEL_MODULE`/`MarketplaceChannelModuleService.getCredential`/`saveCredential` (Task 1); `refreshAccessToken` (Task 2).
- Produces: nada consumido por outras tasks — script standalone, agendado externamente (cron do servidor, mesmo padrão de scripts já existente no projeto).

- [ ] **Step 1: Escrever o teste (RED)**

```ts
jest.mock("../../utils/mercadolivre-client", () => ({
  refreshAccessToken: jest.fn(),
}))

import { refreshAccessToken } from "../../utils/mercadolivre-client"
import mercadolivreTokenRefresh from "../mercadolivre-token-refresh"
import { MARKETPLACE_CHANNEL_MODULE } from "../../modules/marketplace-channel"

function makeContainer(channelService: unknown, logger: unknown = { info: jest.fn(), error: jest.fn() }) {
  return {
    resolve: (key: string) => {
      if (key === MARKETPLACE_CHANNEL_MODULE) return channelService
      if (key === "logger") return logger
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
}

describe("mercadolivreTokenRefresh", () => {
  beforeEach(() => jest.clearAllMocks())

  it("does nothing when there is no credential yet", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue(null), saveCredential: jest.fn() }
    const container = makeContainer(channelService)

    await mercadolivreTokenRefresh({ container } as any)

    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it("does nothing when the token still has more than 30 minutes of validity", async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000) // 1h à frente
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ refreshToken: "r1", expiresAt: farFuture }),
      saveCredential: jest.fn(),
    }
    const container = makeContainer(channelService)

    await mercadolivreTokenRefresh({ container } as any)

    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it("refreshes and saves the new token when it's within 30 minutes of expiring", async () => {
    const soon = new Date(Date.now() + 10 * 60 * 1000) // 10min à frente
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ refreshToken: "old-refresh", expiresAt: soon }),
      saveCredential: jest.fn(),
    }
    ;(refreshAccessToken as jest.Mock).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 21600,
    })
    const container = makeContainer(channelService)

    await mercadolivreTokenRefresh({ container } as any)

    expect(refreshAccessToken).toHaveBeenCalledWith("old-refresh")
    expect(channelService.saveCredential).toHaveBeenCalledWith(
      "mercado_livre",
      "new-access",
      "new-refresh",
      expect.any(Date)
    )
  })

  it("logs an error and does not throw when the refresh call fails", async () => {
    const soon = new Date(Date.now() + 10 * 60 * 1000)
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ refreshToken: "old-refresh", expiresAt: soon }),
      saveCredential: jest.fn(),
    }
    const logger = { info: jest.fn(), error: jest.fn() }
    ;(refreshAccessToken as jest.Mock).mockRejectedValue(new Error("network error"))
    const container = makeContainer(channelService, logger)

    await expect(mercadolivreTokenRefresh({ container } as any)).resolves.not.toThrow()

    expect(logger.error).toHaveBeenCalled()
    expect(channelService.saveCredential).not.toHaveBeenCalled()
  })
})
```

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/scripts/__tests__/mercadolivre-token-refresh --runInBand`
Expected: FAIL — `../mercadolivre-token-refresh` não existe.

- [ ] **Step 2: Implementar o script**

```ts
import { MedusaContainer } from "@medusajs/framework/types"
import { MARKETPLACE_CHANNEL_MODULE } from "../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../modules/marketplace-channel/service"
import { refreshAccessToken } from "../utils/mercadolivre-client"

const REFRESH_MARGIN_MS = 30 * 60 * 1000 // renova com 30min de folga antes de expirar

export default async function mercadolivreTokenRefresh({ container }: { container: MedusaContainer }) {
  const channelService: MarketplaceChannelModuleService = container.resolve(MARKETPLACE_CHANNEL_MODULE)
  const logger = container.resolve("logger") as { info: (msg: string) => void; error: (msg: string) => void }

  const credential = await channelService.getCredential("mercado_livre")
  if (!credential) {
    logger.info("[mercadolivre-token-refresh] nenhuma credencial cadastrada, nada a fazer")
    return
  }

  const expiresAt = new Date(credential.expiresAt)
  if (expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    logger.info("[mercadolivre-token-refresh] token ainda válido, nada a fazer")
    return
  }

  try {
    const refreshed = await refreshAccessToken(credential.refreshToken)
    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000)
    await channelService.saveCredential("mercado_livre", refreshed.accessToken, refreshed.refreshToken, newExpiresAt)
    logger.info("[mercadolivre-token-refresh] token renovado com sucesso")
  } catch (err) {
    logger.error(`[mercadolivre-token-refresh] falha ao renovar token: ${err}`)
  }
}
```

- [ ] **Step 3: Rodar o teste (GREEN)**

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/scripts/__tests__/mercadolivre-token-refresh --runInBand`
Expected: PASS — 4/4 testes.

- [ ] **Step 4: Rodar a suíte completa e commitar**

```bash
npm run test:unit
git add packages/medusa-backend/apps/backend/src/scripts/mercadolivre-token-refresh.ts packages/medusa-backend/apps/backend/src/scripts/__tests__/mercadolivre-token-refresh.unit.spec.ts
git commit -m "feat(marketplace-channel): adiciona job de renovação de token do Mercado Livre"
```

---

## Task 4: Rota de publicação de produto

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/admin/marketplace-channel/products/[id]/publish/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/admin/marketplace-channel/products/[id]/publish/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `MARKETPLACE_CHANNEL_MODULE` (Task 1); `getListingFee`/`createItem` (Task 2).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Escrever o teste (RED)**

```ts
jest.mock("../../../../../../../utils/mercadolivre-client", () => ({
  getListingFee: jest.fn(),
  createItem: jest.fn(),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../../../modules/marketplace-channel"
import { getListingFee, createItem } from "../../../../../../utils/mercadolivre-client"
import { POST } from "../route"

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    title: "Bolsa Africana 2 em 1",
    thumbnail: "https://example.com/foto.jpg",
    seller: { id: "seller_1" },
    variants: [{ prices: [{ amount: 18200 }] }],
    ...overrides,
  }
}

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const validBody = { categoryId: "MLB1000", attributes: [{ id: "BRAND", valueName: "Genérica" }] }

describe("POST /admin/marketplace-channel/products/:id/publish", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns 503 when there's no Mercado Livre credential configured", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue(null) }
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({ [MARKETPLACE_CHANNEL_MODULE]: channelService }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(503)
  })

  it("returns 400 when the body fails validation", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }) }
    const req = {
      params: { id: "prod_1" },
      body: {},
      scope: makeScope({ [MARKETPLACE_CHANNEL_MODULE]: channelService }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
  })

  it("publishes the item, records the listing with the resolved sale fee, and returns it", async () => {
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }),
      recordListing: jest.fn().mockResolvedValue(undefined),
    }
    const graph = jest.fn().mockResolvedValue({ data: [makeProduct()] })
    ;(getListingFee as jest.Mock).mockResolvedValue({ percentageFee: 12.5, fixedFee: 5 })
    ;(createItem as jest.Mock).mockResolvedValue({ id: "MLB999888777" })
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({
        [MARKETPLACE_CHANNEL_MODULE]: channelService,
        [ContainerRegistrationKeys.QUERY]: { graph },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(getListingFee).toHaveBeenCalledWith("token-abc", 18200, "MLB1000")
    expect(createItem).toHaveBeenCalledWith("token-abc", expect.objectContaining({ categoryId: "MLB1000", price: 18200 }))
    expect(channelService.recordListing).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "prod_1",
        sellerId: "seller_1",
        externalItemId: "MLB999888777",
        saleFeePercent: 12.5,
        saleFeeFixed: 5,
      })
    )
    expect(res._status).toBe(200)
    expect((res._body as any).externalItemId).toBe("MLB999888777")
  })

  it("returns 400 when the product has no seller associated", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }) }
    const graph = jest.fn().mockResolvedValue({ data: [makeProduct({ seller: null })] })
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({
        [MARKETPLACE_CHANNEL_MODULE]: channelService,
        [ContainerRegistrationKeys.QUERY]: { graph },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
  })

  it("records the listing error and returns 502 when the Mercado Livre API call fails", async () => {
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }),
      recordListingError: jest.fn().mockResolvedValue(undefined),
    }
    const graph = jest.fn().mockResolvedValue({ data: [makeProduct()] })
    ;(getListingFee as jest.Mock).mockRejectedValue(new Error("Mercado Livre listing_prices falhou: 400"))
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({
        [MARKETPLACE_CHANNEL_MODULE]: channelService,
        [ContainerRegistrationKeys.QUERY]: { graph },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(channelService.recordListingError).toHaveBeenCalledWith("prod_1", "seller_1", "mercado_livre", expect.any(String))
    expect(res._status).toBe(502)
  })
})
```

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/marketplace-channel --runInBand`
Expected: FAIL — `../route` não existe.

- [ ] **Step 2: Implementar a rota**

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../../../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../../../../../../modules/marketplace-channel/service"
import { getListingFee, createItem } from "../../../../../../utils/mercadolivre-client"

const schema = z.object({
  categoryId: z.string(),
  attributes: z.array(z.object({ id: z.string(), valueName: z.string() })),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id: productId } = req.params

  const channelService: MarketplaceChannelModuleService = req.scope.resolve(MARKETPLACE_CHANNEL_MODULE)
  const credential = await channelService.getCredential("mercado_livre")
  if (!credential) {
    return res.status(503).json({ error: "Conta do Mercado Livre não conectada." })
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }
  const { categoryId, attributes } = parsed.data

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "thumbnail", "seller.id", "variants.prices.amount"],
    filters: { id: productId },
  })
  const product = (products as any[])[0]
  if (!product) {
    return res.status(404).json({ error: "Produto não encontrado." })
  }
  const sellerId = product.seller?.id
  if (!sellerId) {
    return res.status(400).json({ error: "Produto sem vendedor associado." })
  }
  const price = product.variants?.[0]?.prices?.[0]?.amount
  if (!price) {
    return res.status(400).json({ error: "Produto sem preço cadastrado." })
  }

  try {
    const fee = await getListingFee(credential.accessToken, price, categoryId)
    const { id: externalItemId } = await createItem(credential.accessToken, {
      title: product.title,
      categoryId,
      price,
      availableQuantity: 1,
      pictures: product.thumbnail ? [{ source: product.thumbnail }] : [],
      attributes: attributes.map((a) => ({ id: a.id, value_name: a.valueName })),
    })

    await channelService.recordListing({
      productId,
      sellerId,
      channel: "mercado_livre",
      externalItemId,
      externalCategoryId: categoryId,
      saleFeePercent: fee.percentageFee,
      saleFeeFixed: fee.fixedFee,
    })

    res.json({ externalItemId, saleFeePercent: fee.percentageFee, saleFeeFixed: fee.fixedFee })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    await channelService.recordListingError(productId, sellerId, "mercado_livre", msg)
    res.status(502).json({ error: "Erro ao publicar no Mercado Livre.", detail: msg })
  }
}
```

- [ ] **Step 3: Rodar o teste (GREEN)**

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/marketplace-channel --runInBand`
Expected: PASS — 5/5 testes.

- [ ] **Step 4: Rodar a suíte completa e commitar**

```bash
npm run test:unit
git add packages/medusa-backend/apps/backend/src/api/admin/marketplace-channel
git commit -m "feat(marketplace-channel): adiciona rota de publicação de produto no Mercado Livre"
```

---

## Task 5: Webhook de pedido do Mercado Livre

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadolivre/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/webhooks/mercadolivre/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `MARKETPLACE_CHANNEL_MODULE`/`findListingByExternalItemId`/`getCredential` (Task 1); `getOrder`/`verifyWebhookSignature` (Task 2).
- Produces: pedidos com `metadata.channel = "mercado_livre"` e `metadata.mercadolivre_item_id` — consumidos pela Task 6 (comissão) pra resolver a taxa do ML.

**Nota de design:** o pedido criado aqui não recebe `shipping_address` (o comprador e o endereço de entrega pertencem ao Mercado Livre, não ao checkout próprio) — por isso `order-placed-whatsapp.ts` (Task 6) não envia confirmação por WhatsApp pra pedidos deste canal (o subscriber já retorna cedo quando não há `shipping_address.phone`, sem nenhuma mudança necessária nele). Isso é intencional: o próprio Mercado Livre já notifica o comprador pelo app dele.

- [ ] **Step 1: Escrever o teste (RED)**

```ts
jest.mock("../../../../utils/mercadolivre-client", () => ({
  getOrder: jest.fn(),
  verifyWebhookSignature: jest.fn(),
}))

import { Modules } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../modules/marketplace-channel"
import { getOrder, verifyWebhookSignature } from "../../../../utils/mercadolivre-client"
import { POST } from "../route"

function makeReq(body: unknown, overrides: Record<string, unknown> = {}) {
  const orderService = {
    listOrders: jest.fn().mockResolvedValue([]),
    createOrders: jest.fn().mockResolvedValue([{ id: "order_1" }]),
  }
  const eventBusService = { emit: jest.fn().mockResolvedValue(undefined) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const channelService = {
    getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }),
    findListingByExternalItemId: jest.fn().mockResolvedValue({ sellerId: "seller_1" }),
  }
  return {
    body,
    headers: { "x-signature": "ts=1700000000,v1=abcdef", "x-request-id": "req-1" },
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === MARKETPLACE_CHANNEL_MODULE) return channelService
        if (key === Modules.ORDER) return orderService
        if (key === Modules.EVENT_BUS) return eventBusService
        return {}
      },
    },
    _orderService: orderService,
    _eventBusService: eventBusService,
    _channelService: channelService,
    ...overrides,
  } as any
}

function makeRes() {
  const res = { _status: 200 } as any
  res.sendStatus = (code: number) => { res._status = code; return res }
  return res
}

const paidMlOrder = {
  id: 555,
  status: "paid",
  buyer: { id: 1, nickname: "comprador1", billing_info: { doc_number: "12345678900", doc_type: "CPF" } },
  order_items: [{ item: { id: "MLB999", title: "Bolsa Africana 2 em 1" }, quantity: 1, unit_price: 182 }],
}

describe("POST /webhooks/mercadolivre", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.MERCADOLIVRE_WEBHOOK_SECRET = "webhook-secret"
    ;(verifyWebhookSignature as jest.Mock).mockReturnValue(true)
  })

  it("returns 200 without processing when the topic isn't orders_v2", async () => {
    const req = makeReq({ topic: "items", resource: "/items/MLB999" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("returns 200 without processing when the signature is invalid", async () => {
    ;(verifyWebhookSignature as jest.Mock).mockReturnValue(false)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(getOrder).not.toHaveBeenCalled()
  })

  it("returns 200 without creating an order when the ML order isn't paid yet", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue({ ...paidMlOrder, status: "pending" })
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("creates an order tagged with channel mercado_livre, the resolved seller_id, and the buyer's document", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(req._channelService.findListingByExternalItemId).toHaveBeenCalledWith("MLB999")
    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata).toEqual(
      expect.objectContaining({
        channel: "mercado_livre",
        mercadolivre_order_id: "555",
        seller_id: "seller_1",
        buyer_document: "12345678900",
      })
    )
  })

  it("stores buyer_document as null when the ML order has no billing info", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue({ ...paidMlOrder, buyer: { id: 1, nickname: "comprador1" } })
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].metadata.buyer_document).toBeNull()
  })

  it("stores unit_price in centavos (no /100 conversion)", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders[0].items[0].unit_price).toBe(18200)
  })

  it("emits marketplace.order_placed after creating the order", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })

    await POST(req, makeRes())

    expect(req._eventBusService.emit).toHaveBeenCalledWith([
      expect.objectContaining({ name: "marketplace.order_placed", data: { id: "order_1" } }),
    ])
  })

  it("does not create a duplicate order when the ML order was already processed", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    req._orderService.listOrders.mockResolvedValue([{ id: "order_existing" }])

    await POST(req, makeRes())

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("does not create an order when the item's channel_listing isn't found locally", async () => {
    ;(getOrder as jest.Mock).mockResolvedValue(paidMlOrder)
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    req._channelService.findListingByExternalItemId.mockResolvedValue(null)

    await POST(req, makeRes())

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("returns 200 even when an unexpected error occurs", async () => {
    ;(getOrder as jest.Mock).mockRejectedValue(new Error("network error"))
    const req = makeReq({ topic: "orders_v2", resource: "/orders/555" })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
  })
})
```

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/webhooks/mercadolivre --runInBand`
Expected: FAIL — `../route` não existe.

- [ ] **Step 2: Implementar o webhook**

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../../../modules/marketplace-channel/service"
import { getOrder, verifyWebhookSignature } from "../../../utils/mercadolivre-client"

type MLWebhookBody = {
  topic?: string
  resource?: string
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")
  const body = req.body as MLWebhookBody

  if (body.topic !== "orders_v2" || !body.resource) {
    return res.sendStatus(200)
  }

  const orderId = body.resource.split("/").pop()
  if (!orderId) return res.sendStatus(200)

  const xSignature = (req.headers["x-signature"] as string) ?? ""
  const xRequestId = (req.headers["x-request-id"] as string) ?? ""
  const isValid = verifyWebhookSignature({
    xSignature,
    xRequestId,
    dataId: orderId,
    secret: process.env.MERCADOLIVRE_WEBHOOK_SECRET ?? "",
  })
  if (!isValid) {
    logger.error(`[mercadolivre/webhook] assinatura inválida para o pedido ${orderId} — notificação ignorada`)
    return res.sendStatus(200)
  }

  try {
    const channelService: MarketplaceChannelModuleService = req.scope.resolve(MARKETPLACE_CHANNEL_MODULE)
    const credential = await channelService.getCredential("mercado_livre")
    if (!credential) {
      logger.error("[mercadolivre/webhook] credencial não configurada, pedido não processado")
      return res.sendStatus(200)
    }

    const mlOrder = await getOrder(credential.accessToken, orderId)
    if (mlOrder.status !== "paid") {
      return res.sendStatus(200)
    }

    const orderService = req.scope.resolve(Modules.ORDER)
    const eventBusService = req.scope.resolve(Modules.EVENT_BUS)

    const existing = await orderService.listOrders(
      { metadata: { mercadolivre_order_id: String(mlOrder.id) } } as any,
      { take: 1 }
    )
    if (existing.length > 0) {
      logger.info(`[mercadolivre/webhook] pedido ${mlOrder.id} já processado — ignorando`)
      return res.sendStatus(200)
    }

    const firstItemId = mlOrder.order_items[0]?.item.id
    const listing = firstItemId ? await channelService.findListingByExternalItemId(firstItemId) : null
    if (!listing) {
      logger.error(`[mercadolivre/webhook] anúncio ${firstItemId} não encontrado nos registros locais — pedido ${mlOrder.id} não criado`)
      return res.sendStatus(200)
    }

    const [order] = await orderService.createOrders([
      {
        currency_code: "brl",
        email: `${mlOrder.buyer?.nickname ?? "comprador"}@mercadolivre.com.br`,
        items: mlOrder.order_items.map((i) => ({
          title: i.item.title,
          quantity: i.quantity,
          unit_price: Math.round(i.unit_price * 100),
        })),
        metadata: {
          channel: "mercado_livre",
          mercadolivre_order_id: String(mlOrder.id),
          mercadolivre_item_id: firstItemId,
          seller_id: listing.sellerId,
          buyer_document: mlOrder.buyer?.billing_info?.doc_number ?? null,
        },
      },
    ])

    logger.info(`[mercadolivre/webhook] pedido criado: ${order.id}`)

    await eventBusService.emit([{ name: "marketplace.order_placed", data: { id: order.id } }])
  } catch (err) {
    logger.error("[mercadolivre/webhook] erro ao processar notificação:", err)
  }

  res.sendStatus(200)
}
```

- [ ] **Step 3: Rodar o teste (GREEN)**

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/webhooks/mercadolivre --runInBand`
Expected: PASS — 10/10 testes.

- [ ] **Step 4: Rodar a suíte completa e commitar**

```bash
npm run test:unit
git add packages/medusa-backend/apps/backend/src/api/webhooks/mercadolivre
git commit -m "feat(marketplace-channel): adiciona webhook de pedido do Mercado Livre"
```

---

## Task 6: Subscribers existentes passam a escutar pedidos de qualquer canal

**Nota importante:** esta branch nasceu de `develop`, que ainda **não** contém a reescrita de `commission-on-payment.ts`/`order-placed-whatsapp.ts` feita em paralelo na branch `fix/multi-seller-cart-order-split` (rateio de taxa fixa entre pedidos-irmãos, consolidação de WhatsApp por pagamento) — aquela branch ainda não foi mergeada em `develop` no momento deste plano. Os três subscribers aqui estão, portanto, na versão **simples**, anterior a essa reconciliação. Este task modifica exatamente essa versão simples; quando `fix/multi-seller-cart-order-split` for mergeada em `develop`, um merge futuro desta branch precisará reconciliar as duas mudanças (fora do escopo deste plano).

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/commission-on-payment.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/order-fiscal-emit.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/order-placed-whatsapp.ts`

**Interfaces:**
- Consumes: `metadata.channel`/`metadata.mercadolivre_item_id` produzidos pela Task 5; `MARKETPLACE_CHANNEL_MODULE`/`findListingByExternalItemId` (Task 1).
- Produces: nada consumido por outras tasks — última task do plano.

- [ ] **Step 1: Escrever os testes novos pro caminho Mercado Livre (RED)**

Adicionar ao final de `commission-on-payment.unit.spec.ts`, dentro do `describe("commissionOnPayment", ...)` (mantendo os testes existentes do caminho MercadoPago intactos):

```ts
  it("computes bankingFees from the Mercado Livre sale fee (stored on the listing) when the order's channel is mercado_livre, instead of the MercadoPago fee formula", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue({
      ...baseOrder,
      metadata: { seller_id: "seller_1", channel: "mercado_livre", mercadolivre_item_id: "MLB999" },
    })
    const channelService = {
      findListingByExternalItemId: jest.fn().mockResolvedValue({ saleFeePercent: 12.5, saleFeeFixed: 500 }),
    }
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
      marketplace_channel: channelService,
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    // baseOrder.total = 10000; 10000 * 12.5% = 1250 (arredondado) + 500 fixo = 1750
    expect(channelService.findListingByExternalItemId).toHaveBeenCalledWith("MLB999")
    expect(recordAndCreate).toHaveBeenCalledWith(
      expect.objectContaining({ grossAmount: 10000, bankingFees: 1750 })
    )
  })

  it("treats a mercado_livre order with no resolvable listing as zero sale fee, instead of failing", async () => {
    const retrieveOrder = jest.fn().mockResolvedValue({
      ...baseOrder,
      metadata: { seller_id: "seller_1", channel: "mercado_livre", mercadolivre_item_id: "MLB999" },
    })
    const channelService = { findListingByExternalItemId: jest.fn().mockResolvedValue(null) }
    const recordAndCreate = jest.fn().mockResolvedValue({ id: "comm_new", sellerPayout: 0 })
    const container = makeContainer({
      [Modules.ORDER]: { retrieveOrder },
      commission: { listCommissions: jest.fn().mockResolvedValue([]), recordAndCreate },
      payout: { listPayouts: jest.fn().mockResolvedValue([]) },
      marketplace_channel: channelService,
    })

    await commissionOnPayment({ event: { data: { id: "order_1" } }, container } as any)

    expect(recordAndCreate).toHaveBeenCalledWith(expect.objectContaining({ bankingFees: 0 }))
  })
```

Adicionar num novo arquivo de teste `packages/medusa-backend/apps/backend/src/subscribers/__tests__/commission-on-payment-config.unit.spec.ts` (arquivo separado, pra não precisar importar `config` no meio do spec principal que já importa o `default export`):

```ts
import { config } from "../commission-on-payment"

describe("commissionOnPayment config", () => {
  it("subscribes to both order.payment_captured and marketplace.order_placed", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["order.payment_captured", "marketplace.order_placed"])
    )
  })
})
```

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/subscribers/__tests__/commission-on-payment --runInBand`
Expected: FAIL — os 2 testes novos do spec principal falham (subscriber ainda não sabe lidar com `channel: "mercado_livre"`); o novo arquivo de config falha (`config.event` ainda é string).

- [ ] **Step 2: Adaptar `commission-on-payment.ts`**

Adicionar os imports do módulo de canal logo depois dos imports existentes:
```ts
import { MARKETPLACE_CHANNEL_MODULE } from "../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../modules/marketplace-channel/service"
```

Substituir a linha `const bankingFees = estimateBankingFees(grossAmount)` por uma ramificação por canal (a função `estimateBankingFees` existente não muda, só passa a ser usada dentro do `else`):

```ts
  const channel = (order.metadata?.channel as string) ?? "mercadopago"

  let bankingFees: number
  if (channel === "mercado_livre") {
    const channelService: MarketplaceChannelModuleService = container.resolve(MARKETPLACE_CHANNEL_MODULE)
    const itemId = order.metadata?.mercadolivre_item_id as string | undefined
    const listing = itemId ? await channelService.findListingByExternalItemId(itemId) : null
    const feePercent = Number(listing?.saleFeePercent ?? 0)
    const feeFixed = Number(listing?.saleFeeFixed ?? 0)
    bankingFees = Math.round(grossAmount * (feePercent / 100)) + feeFixed
  } else {
    bankingFees = estimateBankingFees(grossAmount)
  }
```

(`grossAmount` continua vindo de `order.total`, sem nenhuma mudança — os pedidos criados no webhook do Mercado Livre, Task 5, nunca recebem `shipping_methods`, porque o frete daquele canal é 100% gerido pelo próprio Mercado Envios; `order.total` de um pedido do ML é, portanto, só a soma dos itens, o que já respeita a regra de negócio de que comissão nunca incide sobre frete, sem precisar de nenhuma lógica adicional de separação aqui.)

Trocar a declaração do evento no final do arquivo:
```ts
export const config: SubscriberConfig = {
  // Escuta tanto pedidos vindos do checkout próprio (MercadoPago) quanto de
  // canais de venda externos (Mercado Livre) — ver marketplace-channel.
  event: ["order.payment_captured", "marketplace.order_placed"],
}
```

- [ ] **Step 3: Rodar os testes (GREEN)**

Run: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/subscribers/__tests__/commission-on-payment --runInBand`
Expected: PASS — 9/9 testes no total (o padrão `commission-on-payment` casa com os dois arquivos: 6 testes já existentes + 2 novos em `commission-on-payment.unit.spec.ts`, mais 1 em `commission-on-payment-config.unit.spec.ts`).

- [ ] **Step 4: Adaptar `order-fiscal-emit.ts` e `order-placed-whatsapp.ts`**

Em cada um, trocar só a config do subscriber (nenhuma outra linha muda — os dois já leem tudo genericamente de `order.metadata`/`order.items`/`shipping_address`, sem nenhuma suposição sobre a origem do pedido; `order-placed-whatsapp.ts` simplesmente não envia mensagem pra pedidos do ML, porque estes não têm `shipping_address` — ver nota de design na Task 5):

`order-fiscal-emit.ts`:
```ts
export const config: SubscriberConfig = {
  event: ["mercadopago.order_approved", "marketplace.order_placed"],
}
```

`order-placed-whatsapp.ts`:
```ts
export const config: SubscriberConfig = {
  event: ["order.placed", "marketplace.order_placed"],
}
```

Criar `order-fiscal-emit-config.unit.spec.ts` e `order-placed-whatsapp-config.unit.spec.ts` (mesmo padrão de arquivo de teste separado do Step 1, um por subscriber, no diretório `__tests__`):

```ts
import { config } from "../order-fiscal-emit"

describe("orderFiscalEmit config", () => {
  it("subscribes to both mercadopago.order_approved and marketplace.order_placed", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["mercadopago.order_approved", "marketplace.order_placed"])
    )
  })
})
```

```ts
import { config } from "../order-placed-whatsapp"

describe("orderPlacedWhatsApp config", () => {
  it("subscribes to both order.placed and marketplace.order_placed", () => {
    expect(config.event).toEqual(
      expect.arrayContaining(["order.placed", "marketplace.order_placed"])
    )
  })
})
```

- [ ] **Step 5: Rodar a suíte completa, o typecheck, e commitar**

```bash
npm run test:unit
npx tsc --noEmit
git add packages/medusa-backend/apps/backend/src/subscribers
git commit -m "feat(marketplace-channel): comissão, NF-e e WhatsApp passam a reagir a pedidos de qualquer canal"
```
