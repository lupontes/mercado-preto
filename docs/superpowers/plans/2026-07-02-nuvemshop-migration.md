# Nuvemshop → Mercado Preto Product Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the "Mulheres de Axé do Brasil" (MAB) store's catalog (products, images, descriptions, categories, variants) from Nuvemshop into the Mercado Preto marketplace as its first seller.

**Architecture:** A single `medusa exec` script run once from `packages/medusa-backend/apps/backend`. It fetches store/category/product data from the Nuvemshop REST API, creates the seller record, re-hosts every product image through Medusa's file module, and creates products via `createProductsWorkflow`, linking each to the seller via the existing `seller-product` link module.

**Tech Stack:** Medusa.js v2.15.2 (`@medusajs/medusa/core-flows`), Node.js 22 built-in `fetch`, `sanitize-html`, Jest + `@swc/jest` (existing project test runner).

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-07-02-nuvemshop-migration-design.md` — every task below implements a part of it; do not deviate from its accepted risks (checkout enabled, no payout config, no preview environment) without checking with the user first.
- This is intentionally a **one-off script**, not a reusable import feature — do not build an admin UI, API route, or generic multi-tenant importer.
- No commission/payout wiring for this seller. No inventory quantity sync (stock levels) — out of scope, `manage_inventory` flag is mapped but on-hand quantities are left for manual admin configuration after migration.
- Seller is created with `status: "active"` (required for storefront/search visibility — see `api/store/search/route.ts:33` and `api/store/sellers/[id]/products/route.ts:12`). Products are created with `status: ProductStatus.PUBLISHED`.
- All HTML coming from the Nuvemshop API (`description` field) MUST be sanitized before being stored — it is untrusted external input rendered on the storefront.
- Idempotency: every product and category created by the script carries `external_id` (`nuvemshop:product:<id>` / `nuvemshop:category:<id>`) so the script can be re-run safely (skips existing records instead of duplicating).
- Real Nuvemshop credentials already exist in `scripts/nuvemshop-migration/.env` (App ID `35695`, tested access token, store ID `3779773`). Never print or commit token/secret values.

---

### Task 1: Fix production image storage path and public URL

**Files:**
- Modify: `packages/medusa-backend/apps/backend/medusa-config.ts`
- Modify: `packages/medusa-backend/apps/backend/.env.template`
- Modify: `infra/docker-compose.prod.yml`
- Test: `packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/file-config.unit.spec.ts`

**Interfaces:**
- Produces: `BACKEND_URL` env var is now load-bearing for both MercadoPago webhooks (already, unchanged) and file uploads (new).

Medusa's default local file provider (`@medusajs/file-local`, auto-registered when no `file` module is declared) writes to `<process.cwd()>/static` and builds public URLs from a `backend_url` option that defaults to `http://localhost:9000/static`. Since `medusa-config.ts` never declares a `file` module today, every image uploaded in production would resolve to a `localhost` URL. This task makes the config explicit and reuses the existing `BACKEND_URL` env var (already used in `src/api/store/checkout/payment/route.ts:46`).

- [ ] **Step 1: Write a failing test asserting the file module config shape**

```ts
// src/scripts/nuvemshop-import/__tests__/file-config.unit.spec.ts
describe("medusa-config file module", () => {
  it("registers @medusajs/file-local with backend_url built from BACKEND_URL", () => {
    process.env.BACKEND_URL = "https://api.mercadopreto.com.br"
    process.env.DATABASE_URL = "postgres://x"
    process.env.JWT_SECRET = "x"
    process.env.COOKIE_SECRET = "x"
    process.env.STORE_CORS = "x"
    process.env.ADMIN_CORS = "x"
    process.env.AUTH_CORS = "x"

    jest.resetModules()
    // medusa-config.ts uses `module.exports = defineConfig(...)`, so requiring
    // it returns the config object directly (no `.default` wrapper).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require("../../../../medusa-config")

    const fileModule = config.modules.find(
      (m: any) => m.resolve === "@medusajs/medusa/file"
    )
    expect(fileModule).toBeDefined()
    expect(fileModule.options.providers[0].resolve).toBe("@medusajs/file-local")
    expect(fileModule.options.providers[0].options.backend_url).toBe(
      "https://api.mercadopreto.com.br/static"
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/medusa-backend/apps/backend`): `npm run test:unit -- file-config`
Expected: FAIL — `fileModule` is `undefined` (no `file` module declared yet in `medusa-config.ts`).

- [ ] **Step 3: Add the explicit file module to `medusa-config.ts`**

In `packages/medusa-backend/apps/backend/medusa-config.ts`, add this entry to the `modules` array (after the `fiscal` module, before `fulfillment`):

```ts
    // Storage de arquivos — imagens de produtos migradas re-hospedadas localmente
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-local",
            id: "local",
            options: {
              backend_url: `${process.env.BACKEND_URL}/static`,
            },
          },
        ],
      },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- file-config`
Expected: PASS

- [ ] **Step 5: Add `BACKEND_URL` volume/env documentation**

`packages/medusa-backend/apps/backend/.env.template` currently has no `BACKEND_URL` entry even though it's used by checkout webhooks. Add this section right before the `Ambiente` section at the bottom:

```
# -----------------------------------------------------------------------------
# URL pública do backend [OBRIGATÓRIO em produção]
# Usada para montar notification_url dos webhooks do MercadoPago e para
# montar a URL pública das imagens de produto re-hospedadas (file module).
# Dev local: use um túnel (ex: ngrok http 9000) ou deixe vazio.
# -----------------------------------------------------------------------------
BACKEND_URL=https://api.mercadopreto.com.br
```

- [ ] **Step 6: Add persistent volume for `static/` in production compose**

In `infra/docker-compose.prod.yml`, find the `medusa-backend` (or equivalently named) service block and add a `volumes` entry (create the key if the service has none yet):

```yaml
  medusa-backend:
    volumes:
      - backend_uploads:/app/static
```

At the bottom of the file, add the volume to the top-level `volumes:` map alongside `postgres_data`, `redis_data`, `meilisearch_data`:

```yaml
volumes:
  postgres_data:
  redis_data:
  meilisearch_data:
  backend_uploads:
```

- [ ] **Step 7: Validate compose syntax**

Run (from `infra/`): `docker compose -f docker-compose.prod.yml config --quiet`
Expected: no output, exit code 0 (confirms YAML is valid and the new volume/service block parse correctly).

- [ ] **Step 8: Commit**

```bash
git add packages/medusa-backend/apps/backend/medusa-config.ts \
        packages/medusa-backend/apps/backend/.env.template \
        packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/file-config.unit.spec.ts \
        infra/docker-compose.prod.yml
git commit -m "fix(infra): configure local file provider backend_url and persist static/ volume"
```

---

### Task 2: HTML sanitizer for product descriptions

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/sanitize.ts`
- Test: `packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/sanitize.unit.spec.ts`
- Modify: `packages/medusa-backend/apps/backend/package.json`

**Interfaces:**
- Produces: `sanitizeDescription(html: string | undefined): string` — used by Task 4's product mapper.

- [ ] **Step 1: Install the dependency**

Run (from `packages/medusa-backend/apps/backend`):
```bash
npm install sanitize-html
npm install --save-dev @types/sanitize-html
```
Expected: `sanitize-html` added to `dependencies`, `@types/sanitize-html` added to `devDependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// src/scripts/nuvemshop-import/__tests__/sanitize.unit.spec.ts
import { sanitizeDescription } from "../sanitize"

describe("sanitizeDescription", () => {
  it("strips script tags from Nuvemshop HTML descriptions", () => {
    const dirty = '<p>Bolsa artesanal</p><script>alert("xss")</script>'
    const clean = sanitizeDescription(dirty)
    expect(clean).not.toContain("<script")
    expect(clean).not.toContain("alert")
    expect(clean).toContain("Bolsa artesanal")
  })

  it("keeps common formatting tags", () => {
    const dirty = "<p>Linha 1</p><p><strong>Linha 2</strong></p>"
    const clean = sanitizeDescription(dirty)
    expect(clean).toContain("<p>")
    expect(clean).toContain("<strong>")
  })

  it("strips inline event handler attributes", () => {
    const dirty = '<p onclick="alert(1)">Clique</p>'
    const clean = sanitizeDescription(dirty)
    expect(clean).not.toContain("onclick")
  })

  it("returns an empty string for undefined input", () => {
    expect(sanitizeDescription(undefined)).toBe("")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- sanitize`
Expected: FAIL with "Cannot find module '../sanitize'"

- [ ] **Step 4: Implement the sanitizer**

```ts
// src/scripts/nuvemshop-import/sanitize.ts
import sanitizeHtml from "sanitize-html"

export function sanitizeDescription(html: string | undefined): string {
  return sanitizeHtml(html ?? "", {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt"],
    },
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- sanitize`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/package.json \
        packages/medusa-backend/apps/backend/package-lock.json \
        packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/sanitize.ts \
        packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/sanitize.unit.spec.ts
git commit -m "feat(nuvemshop-import): add HTML sanitizer for imported product descriptions"
```

---

### Task 3: Nuvemshop API client

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/client.ts`
- Test: `packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/client.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (talks to the real Nuvemshop REST API over HTTP).
- Produces: `NuvemshopClient` class with `getStore()`, `listCategories()`, `iterateProducts()` (async generator of pages), plus types `NuvemshopStore`, `NuvemshopCategory`, `NuvemshopImage`, `NuvemshopVariant`, `NuvemshopProduct` — consumed by Task 4's mappers and Task 6's orchestrator script.

Field shapes below were captured from real `GET /store`, `GET /categories`, `GET /products` responses against the actual MAB store (see design spec) — not guessed from documentation alone. Notably: `category.parent` is `0` for root categories in the real API, not `null` as the docs say.

- [ ] **Step 1: Write the failing tests**

```ts
// src/scripts/nuvemshop-import/__tests__/client.unit.spec.ts
import { NuvemshopClient } from "../client"

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json: any }>) {
  const fetchMock = jest.fn()
  responses.forEach((r) => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({
        ok: r.ok,
        status: r.status ?? 200,
        json: () => Promise.resolve(r.json),
      })
    )
  })
  global.fetch = fetchMock as any
  return fetchMock
}

describe("NuvemshopClient", () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it("getStore() calls /store with auth headers and returns parsed JSON", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { email: "contato@mercadopreto.com.br" } },
    ])
    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "tok_123" })

    const store = await client.getStore()

    expect(store.email).toBe("contato@mercadopreto.com.br")
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.tiendanube.com/v1/3779773/store")
    expect(options.headers.Authentication).toBe("bearer tok_123")
    expect(options.headers["User-Agent"]).toContain("Mercado Preto Migration")
  })

  it("listCategories() paginates until a page returns fewer than 30 items", async () => {
    const fullPage = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      parent: 0,
      name: { pt: `Categoria ${i + 1}` },
    }))
    const lastPage = [{ id: 999, parent: 0, name: { pt: "Última" } }]
    mockFetchSequence([{ ok: true, json: fullPage }, { ok: true, json: lastPage }])

    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "tok_123" })
    const categories = await client.listCategories()

    expect(categories).toHaveLength(31)
  })

  it("iterateProducts() yields each page and stops on an empty page", async () => {
    const page1 = [{ id: 1, name: { pt: "A" }, description: {}, attributes: [], images: [], variants: [], categories: [] }]
    mockFetchSequence([{ ok: true, json: page1 }, { ok: true, json: [] }])

    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "tok_123" })
    const pages = []
    for await (const page of client.iterateProducts()) {
      pages.push(page)
    }

    expect(pages).toHaveLength(1)
    expect(pages[0]).toEqual(page1)
  })

  it("throws when the API responds with a non-2xx status", async () => {
    mockFetchSequence([{ ok: false, status: 401, json: {} }])
    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "bad" })

    await expect(client.getStore()).rejects.toThrow("Nuvemshop API respondeu 401")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- client`
Expected: FAIL with "Cannot find module '../client'"

- [ ] **Step 3: Implement the client**

```ts
// src/scripts/nuvemshop-import/client.ts
const API_BASE = "https://api.tiendanube.com/v1"
const USER_AGENT = "Mercado Preto Migration (lupontes@gmail.com)"
const PER_PAGE = 30

export interface NuvemshopStore {
  email: string
  phone: string | null
  business_id: string | null
  business_name: string | null
  address: string | null
}

export interface NuvemshopCategory {
  id: number
  parent: number | null
  name: { pt?: string }
}

export interface NuvemshopImage {
  id: number
  src: string
  position: number
}

export interface NuvemshopVariant {
  id: number
  price: string
  sku: string | null
  stock_management: boolean
  weight: string | null
  width: string | null
  height: string | null
  depth: string | null
  values: { pt?: string }[]
}

export interface NuvemshopProduct {
  id: number
  name: { pt?: string }
  description: { pt?: string }
  attributes: { pt?: string }[]
  images: NuvemshopImage[]
  variants: NuvemshopVariant[]
  categories: { id: number }[]
}

export interface NuvemshopClientConfig {
  storeId: string
  accessToken: string
}

export class NuvemshopClient {
  private readonly storeId: string
  private readonly accessToken: string

  constructor(config: NuvemshopClientConfig) {
    this.storeId = config.storeId
    this.accessToken = config.accessToken
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}/${this.storeId}${path}`, {
      headers: {
        Authentication: `bearer ${this.accessToken}`,
        "User-Agent": USER_AGENT,
      },
    })
    if (!response.ok) {
      throw new Error(`Nuvemshop API respondeu ${response.status} para ${path}`)
    }
    return response.json() as Promise<T>
  }

  async getStore(): Promise<NuvemshopStore> {
    return this.request<NuvemshopStore>("/store")
  }

  async listCategories(): Promise<NuvemshopCategory[]> {
    const categories: NuvemshopCategory[] = []
    for (let page = 1; ; page++) {
      const pageResult = await this.request<NuvemshopCategory[]>(
        `/categories?page=${page}&per_page=${PER_PAGE}`
      )
      categories.push(...pageResult)
      if (pageResult.length < PER_PAGE) break
    }
    return categories
  }

  async *iterateProducts(): AsyncGenerator<NuvemshopProduct[]> {
    for (let page = 1; ; page++) {
      const pageResult = await this.request<NuvemshopProduct[]>(
        `/products?page=${page}&per_page=${PER_PAGE}`
      )
      if (pageResult.length === 0) break
      yield pageResult
      if (pageResult.length < PER_PAGE) break
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- client`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/client.ts \
        packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/client.unit.spec.ts
git commit -m "feat(nuvemshop-import): add Nuvemshop REST API client"
```

---

### Task 4: Category and product mappers

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/mappers.ts`
- Test: `packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/mappers.unit.spec.ts`

**Interfaces:**
- Consumes: `NuvemshopCategory`, `NuvemshopProduct` from `./client` (Task 3); `sanitizeDescription` from `./sanitize` (Task 2).
- Produces: `buildProductExternalId(id: number): string`, `buildCategoryExternalId(id: number): string`, `sortCategoriesByDepth(categories: NuvemshopCategory[]): NuvemshopCategory[]`, `mapProductToWorkflowInput(product: NuvemshopProduct, opts: { categoryIds: string[]; imageUrls: string[]; salesChannelId: string }): CreateProductWorkflowInputDTO` — consumed by Task 6's orchestrator script.

- [ ] **Step 1: Write the failing tests**

```ts
// src/scripts/nuvemshop-import/__tests__/mappers.unit.spec.ts
import {
  buildCategoryExternalId,
  buildProductExternalId,
  mapProductToWorkflowInput,
  sortCategoriesByDepth,
} from "../mappers"
import { NuvemshopCategory, NuvemshopProduct } from "../client"

describe("buildProductExternalId / buildCategoryExternalId", () => {
  it("namespaces ids so they cannot collide with other external systems", () => {
    expect(buildProductExternalId(201563123)).toBe("nuvemshop:product:201563123")
    expect(buildCategoryExternalId(24200349)).toBe("nuvemshop:category:24200349")
  })
})

describe("sortCategoriesByDepth", () => {
  it("orders root categories before their children", () => {
    const categories: NuvemshopCategory[] = [
      { id: 25084598, parent: 24724499, name: { pt: "Colares longos" } },
      { id: 26641225, parent: 0, name: { pt: "MODA AFRICANA" } },
      { id: 24724499, parent: 0, name: { pt: "COLARES" } },
    ]

    const sorted = sortCategoriesByDepth(categories)
    const indexOf = (id: number) => sorted.findIndex((c) => c.id === id)

    expect(indexOf(24724499)).toBeLessThan(indexOf(25084598))
  })

  it("treats parent: 0 as a root category, matching the real Nuvemshop API shape", () => {
    const categories: NuvemshopCategory[] = [
      { id: 1, parent: 0, name: { pt: "Root" } },
    ]
    expect(sortCategoriesByDepth(categories)).toEqual(categories)
  })
})

describe("mapProductToWorkflowInput", () => {
  // Real sample captured from GET /products for the MAB store: a product with
  // no variant attributes (single default variant).
  const singleVariantProduct: NuvemshopProduct = {
    id: 201563123,
    name: { pt: "Bolsa Africana 2 em 1" },
    description: { pt: '<p>Cartonagem com tecido africano</p><script>alert(1)</script>' },
    attributes: [],
    images: [
      { id: 1, src: "https://cdn.example.com/a.jpg", position: 1 },
    ],
    variants: [
      {
        id: 838092190,
        price: "182.00",
        sku: "8730",
        stock_management: true,
        weight: "0.500",
        width: "26.00",
        height: "10.00",
        depth: "20.00",
        values: [],
      },
    ],
    categories: [{ id: 24200349 }],
  }

  it("maps a single-variant product (no attributes) to a 'Padrão' option/variant", () => {
    const result = mapProductToWorkflowInput(singleVariantProduct, {
      categoryIds: ["pcat_01"],
      imageUrls: ["https://api.mercadopreto.com.br/static/a.jpg"],
      salesChannelId: "sc_01",
    })

    expect(result.title).toBe("Bolsa Africana 2 em 1")
    expect(result.external_id).toBe("nuvemshop:product:201563123")
    expect(result.category_ids).toEqual(["pcat_01"])
    expect(result.options).toEqual([{ title: "Padrão", values: ["Padrão"] }])
    expect(result.variants).toHaveLength(1)
    expect(result.variants![0]).toMatchObject({
      title: "Padrão",
      sku: "8730",
      manage_inventory: true,
      weight: 0.5,
      width: 26,
      height: 10,
      length: 20,
      options: { Padrão: "Padrão" },
      prices: [{ amount: 182, currency_code: "brl" }],
    })
    expect(result.thumbnail).toBe("https://api.mercadopreto.com.br/static/a.jpg")
    expect(result.sales_channels).toEqual([{ id: "sc_01" }])
  })

  it("sanitizes the HTML description", () => {
    const result = mapProductToWorkflowInput(singleVariantProduct, {
      categoryIds: [],
      imageUrls: [],
      salesChannelId: "sc_01",
    })
    expect(result.description).not.toContain("<script")
    expect(result.description).toContain("Cartonagem com tecido africano")
  })

  it("maps a multi-variant product with attributes to matching options", () => {
    const multiVariantProduct: NuvemshopProduct = {
      id: 555,
      name: { pt: "Camisa Estampada" },
      description: { pt: "<p>Camisa</p>" },
      attributes: [{ pt: "Tamanho" }, { pt: "Cor" }],
      images: [],
      variants: [
        {
          id: 1,
          price: "50.00",
          sku: "CAM-P-AZ",
          stock_management: false,
          weight: null,
          width: null,
          height: null,
          depth: null,
          values: [{ pt: "P" }, { pt: "Azul" }],
        },
        {
          id: 2,
          price: "50.00",
          sku: "CAM-M-AZ",
          stock_management: false,
          weight: null,
          width: null,
          height: null,
          depth: null,
          values: [{ pt: "M" }, { pt: "Azul" }],
        },
      ],
      categories: [],
    }

    const result = mapProductToWorkflowInput(multiVariantProduct, {
      categoryIds: [],
      imageUrls: [],
      salesChannelId: "sc_01",
    })

    expect(result.options).toEqual([
      { title: "Tamanho", values: ["P", "M"] },
      { title: "Cor", values: ["Azul"] },
    ])
    expect(result.variants![0]).toMatchObject({
      title: "P / Azul",
      options: { Tamanho: "P", Cor: "Azul" },
    })
    expect(result.variants![1]).toMatchObject({
      title: "M / Azul",
      options: { Tamanho: "M", Cor: "Azul" },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- mappers`
Expected: FAIL with "Cannot find module '../mappers'"

- [ ] **Step 3: Implement the mappers**

```ts
// src/scripts/nuvemshop-import/mappers.ts
import { ProductStatus } from "@medusajs/framework/utils"
import { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"
import { sanitizeDescription } from "./sanitize"
import { NuvemshopCategory, NuvemshopProduct } from "./client"

export function buildProductExternalId(nuvemshopProductId: number): string {
  return `nuvemshop:product:${nuvemshopProductId}`
}

export function buildCategoryExternalId(nuvemshopCategoryId: number): string {
  return `nuvemshop:category:${nuvemshopCategoryId}`
}

export function sortCategoriesByDepth(
  categories: NuvemshopCategory[]
): NuvemshopCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]))

  const depthOf = (category: NuvemshopCategory, seen: Set<number>): number => {
    const parentId = category.parent && category.parent !== 0 ? category.parent : null
    if (!parentId || seen.has(parentId)) return 0
    const parent = byId.get(parentId)
    if (!parent) return 0
    return 1 + depthOf(parent, new Set(seen).add(parentId))
  }

  return [...categories].sort((a, b) => depthOf(a, new Set()) - depthOf(b, new Set()))
}

export interface MapProductOptions {
  categoryIds: string[]
  imageUrls: string[]
  salesChannelId: string
}

export function mapProductToWorkflowInput(
  product: NuvemshopProduct,
  opts: MapProductOptions
): CreateProductWorkflowInputDTO {
  const hasOptions = product.attributes.length > 0

  const options = hasOptions
    ? product.attributes.map((attr, idx) => ({
        title: attr.pt || `Opção ${idx + 1}`,
        values: [
          ...new Set(
            product.variants
              .map((v) => v.values[idx]?.pt)
              .filter((v): v is string => !!v)
          ),
        ],
      }))
    : [{ title: "Padrão", values: ["Padrão"] }]

  const variantTitle = (variant: NuvemshopProduct["variants"][number]) => {
    if (!hasOptions) return "Padrão"
    const parts = product.attributes
      .map((_, idx) => variant.values[idx]?.pt)
      .filter((v): v is string => !!v)
    return parts.length > 0 ? parts.join(" / ") : "Padrão"
  }

  const variants = product.variants.map((variant) => ({
    title: variantTitle(variant),
    sku: variant.sku || undefined,
    manage_inventory: !!variant.stock_management,
    weight: variant.weight ? parseFloat(variant.weight) : undefined,
    width: variant.width ? parseFloat(variant.width) : undefined,
    height: variant.height ? parseFloat(variant.height) : undefined,
    length: variant.depth ? parseFloat(variant.depth) : undefined,
    options: hasOptions
      ? Object.fromEntries(
          product.attributes.map((attr, idx) => [
            attr.pt || `Opção ${idx + 1}`,
            variant.values[idx]?.pt || "N/A",
          ])
        )
      : { Padrão: "Padrão" },
    prices: [
      {
        amount: parseFloat(variant.price || "0"),
        currency_code: "brl",
      },
    ],
  }))

  return {
    title: product.name.pt || `Produto ${product.id}`,
    description: sanitizeDescription(product.description?.pt),
    status: ProductStatus.PUBLISHED,
    external_id: buildProductExternalId(product.id),
    category_ids: opts.categoryIds,
    images: opts.imageUrls.map((url) => ({ url })),
    thumbnail: opts.imageUrls[0],
    options,
    variants,
    sales_channels: [{ id: opts.salesChannelId }],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- mappers`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/mappers.ts \
        packages/medusa-backend/apps/backend/src/scripts/nuvemshop-import/__tests__/mappers.unit.spec.ts
git commit -m "feat(nuvemshop-import): map Nuvemshop categories and products to Medusa workflow input"
```

---

### Task 5: Wire Nuvemshop credentials into the backend environment

**Files:**
- Modify: `packages/medusa-backend/apps/backend/.env.template`
- Modify: `packages/medusa-backend/apps/backend/.env` (local only, not committed — gitignored)

**Interfaces:**
- Produces: `process.env.NUVEMSHOP_ACCESS_TOKEN`, `process.env.NUVEMSHOP_STORE_ID` — consumed by Task 6's orchestrator script.

The credentials obtained earlier (App ID `35695`, access token, store ID `3779773`) live in `scripts/nuvemshop-migration/.env`, which was only used for the manual OAuth exchange. The `medusa exec` script (Task 6) runs inside the backend app and reads `process.env` the same way `medusa-config.ts` does, so the same two values must also exist in `packages/medusa-backend/apps/backend/.env`.

- [ ] **Step 1: Document the vars in `.env.template`**

Add this section to `packages/medusa-backend/apps/backend/.env.template`, near the other one-off/migration-related sections:

```
# -----------------------------------------------------------------------------
# Nuvemshop — migração única do catálogo da MAB [uso pontual]
# App privado criado em partners.tiendanube.com (App ID 35695).
# Ver docs/superpowers/specs/2026-07-02-nuvemshop-migration-design.md
# -----------------------------------------------------------------------------
NUVEMSHOP_ACCESS_TOKEN=
NUVEMSHOP_STORE_ID=
```

- [ ] **Step 2: Copy the real values into the local `.env`**

Manually copy `NUVEMSHOP_ACCESS_TOKEN` and `NUVEMSHOP_STORE_ID` from `scripts/nuvemshop-migration/.env` into `packages/medusa-backend/apps/backend/.env`. This file is gitignored — do not print its contents in any tool output or commit message.

- [ ] **Step 3: Verify the file is ignored**

Run: `git check-ignore -v packages/medusa-backend/apps/backend/.env`
Expected: prints the matching `.gitignore` rule (confirms it will not be committed).

- [ ] **Step 4: Commit the template only**

```bash
git add packages/medusa-backend/apps/backend/.env.template
git commit -m "docs(backend): document NUVEMSHOP_* env vars for the one-off migration script"
```

---

### Task 6: Orchestrator script (`medusa exec`)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/scripts/import-nuvemshop.ts`

**Interfaces:**
- Consumes: `NuvemshopClient` (Task 3), `sortCategoriesByDepth`/`mapProductToWorkflowInput`/`buildProductExternalId`/`buildCategoryExternalId` (Task 4), `SELLER_MODULE`/`SellerModuleService` (existing `src/modules/seller`), `createProductCategoriesWorkflow`/`createProductsWorkflow`/`uploadFilesWorkflow` (`@medusajs/medusa/core-flows`).
- Produces: nothing importable — this is the script entrypoint, run via CLI.

This is the thin orchestration layer; all business logic it calls was already unit-tested in Tasks 2–4. There is no automated test for this file itself (it talks to a live database and the real Nuvemshop API) — Task 7 is its manual verification.

- [ ] **Step 1: Write the script**

```ts
// src/scripts/import-nuvemshop.ts
import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  uploadFilesWorkflow,
} from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"
import { NuvemshopClient } from "./nuvemshop-import/client"
import {
  buildCategoryExternalId,
  buildProductExternalId,
  mapProductToWorkflowInput,
  sortCategoriesByDepth,
} from "./nuvemshop-import/mappers"

const SELLER_NAME = "Mulheres de Axé do Brasil"

export default async function importNuvemshop({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
  const sellerService: SellerModuleService = container.resolve(SELLER_MODULE)

  const accessToken = process.env.NUVEMSHOP_ACCESS_TOKEN
  const storeId = process.env.NUVEMSHOP_STORE_ID
  if (!accessToken || !storeId) {
    throw new Error(
      "NUVEMSHOP_ACCESS_TOKEN e NUVEMSHOP_STORE_ID precisam estar definidos no .env do backend."
    )
  }
  const client = new NuvemshopClient({ accessToken, storeId })

  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
  })
  const salesChannel = salesChannels[0]
  if (!salesChannel) {
    throw new Error(
      "Nenhum sales channel encontrado. Rode `npx medusa exec ./src/migration-scripts/initial-data-seed.ts` antes deste script."
    )
  }

  logger.info("Buscando dados da loja na Nuvemshop...")
  const store = await client.getStore()

  let seller = (await sellerService.listSellers({ email: store.email }))[0]
  if (!seller) {
    seller = await sellerService.createSellers({
      name: SELLER_NAME,
      ownerName: store.business_name || SELLER_NAME,
      email: store.email,
      phone: store.phone ?? "",
      cpfCnpj: store.business_id ?? "",
      location: store.address ?? null,
      status: "active",
    })
    logger.info(`Seller criado: ${seller.id}`)
  } else {
    logger.info(`Seller já existia: ${seller.id}`)
  }

  logger.info("Buscando categorias na Nuvemshop...")
  const nuvemshopCategories = await client.listCategories()
  const orderedCategories = sortCategoriesByDepth(nuvemshopCategories)

  const categoryIdMap = new Map<number, string>()
  for (const category of orderedCategories) {
    const externalId = buildCategoryExternalId(category.id)
    const { data: existing } = await query.graph({
      entity: "product_category",
      fields: ["id"],
      filters: { external_id: externalId },
    })

    if (existing[0]) {
      categoryIdMap.set(category.id, existing[0].id)
      continue
    }

    const parentId =
      category.parent && category.parent !== 0
        ? categoryIdMap.get(category.parent)
        : undefined

    const {
      result: [created],
    } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: [
          {
            name: category.name.pt || `Categoria ${category.id}`,
            external_id: externalId,
            is_active: true,
            ...(parentId ? { parent_category_id: parentId } : {}),
          },
        ],
      },
    })
    categoryIdMap.set(category.id, created.id)
  }
  logger.info(`${categoryIdMap.size} categorias sincronizadas.`)

  logger.info("Importando produtos...")
  let imported = 0
  let skipped = 0
  let failed = 0

  for await (const page of client.iterateProducts()) {
    for (const product of page) {
      const externalId = buildProductExternalId(product.id)
      const { data: existingProducts } = await query.graph({
        entity: "product",
        fields: ["id"],
        filters: { external_id: externalId },
      })
      if (existingProducts.length > 0) {
        skipped++
        continue
      }

      try {
        const sortedImages = [...product.images].sort((a, b) => a.position - b.position)
        const imageUrls: string[] = []
        for (const image of sortedImages) {
          const response = await fetch(image.src)
          if (!response.ok) {
            throw new Error(`Falha ao baixar imagem ${image.src}: HTTP ${response.status}`)
          }
          const buffer = Buffer.from(await response.arrayBuffer())
          const filename = image.src.split("/").pop() || `${image.id}.jpg`
          const mimeType = response.headers.get("content-type") || "image/jpeg"
          const {
            result: [uploaded],
          } = await uploadFilesWorkflow(container).run({
            input: {
              files: [
                {
                  filename,
                  mimeType,
                  content: buffer.toString("base64"),
                  access: "public",
                },
              ],
            },
          })
          imageUrls.push(uploaded.url)
        }

        const categoryIds = product.categories
          .map((c) => categoryIdMap.get(c.id))
          .filter((id): id is string => !!id)

        const workflowInput = mapProductToWorkflowInput(product, {
          categoryIds,
          imageUrls,
          salesChannelId: salesChannel.id,
        })

        const {
          result: [createdProduct],
        } = await createProductsWorkflow(container).run({
          input: { products: [workflowInput] },
        })

        await remoteLink.create([
          {
            [SELLER_MODULE]: { seller_id: seller.id },
            [Modules.PRODUCT]: { product_id: createdProduct.id },
          },
        ])

        imported++
        logger.info(`Produto importado: ${createdProduct.title}`)
      } catch (err: any) {
        failed++
        logger.error(`Falha ao importar produto Nuvemshop #${product.id}: ${err?.message}`)
      }
    }
  }

  logger.info(
    `Importação concluída. Importados: ${imported}, já existentes (skip): ${skipped}, falhas: ${failed}`
  )
}
```

- [ ] **Step 2: Type-check the script**

Run (from `packages/medusa-backend/apps/backend`): `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `src/scripts/import-nuvemshop.ts` or `src/scripts/nuvemshop-import/*`.

- [ ] **Step 3: Run the full unit suite to confirm nothing else broke**

Run: `npm run test:unit`
Expected: all suites pass, including the new ones from Tasks 1–4.

- [ ] **Step 4: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/scripts/import-nuvemshop.ts
git commit -m "feat(nuvemshop-import): add medusa exec script to migrate the MAB catalog"
```

---

### Task 7: Manual dry run and idempotency verification

**Files:** none (operational verification only, against a real database and the real Nuvemshop store).

**Interfaces:** none — this task exercises the full script built in Tasks 1–6 end-to-end.

- [ ] **Step 1: Confirm local infra is up**

Run (from `infra/` or wherever the dev compose lives): ensure Postgres/Redis are reachable at the URLs in `packages/medusa-backend/apps/backend/.env` (`DATABASE_URL`, `REDIS_URL`). Run: `pg_isready -h localhost -p 5433` (or the project's usual dev-up command).
Expected: `accepting connections`.

- [ ] **Step 2: Run pending Medusa migrations**

Run (from `packages/medusa-backend/apps/backend`): `npx medusa db:migrate`
Expected: exits 0, no pending migrations left.

- [ ] **Step 3: Confirm a sales channel exists**

Run: `npx medusa exec ./src/migration-scripts/initial-data-seed.ts` **only if** no sales channel exists yet in this database (check first via the admin dashboard or `psql "$DATABASE_URL" -c "select id from sales_channel;"`). Do not re-run the seed if a sales channel is already present — it is not idempotent and will duplicate store/region/shipping data.

- [ ] **Step 4: Run the import script**

Run: `npx medusa exec ./src/scripts/import-nuvemshop.ts`
Expected: log lines for seller creation, category sync count, and a final `Importação concluída. Importados: N, já existentes (skip): 0, falhas: 0` (or a small, individually-logged failure count — investigate any before proceeding).

- [ ] **Step 5: Spot-check one product in the admin dashboard**

Open the Medusa admin, find one imported product, and confirm: title matches the Nuvemshop product, description renders correctly (no leftover HTML entities garbling text), all images load (served from the backend's own domain, not `dcdn-us.mitiendanube.com`), variants/options match Nuvemshop, category assigned correctly.

- [ ] **Step 6: Verify storefront visibility**

Open `https://mercadopreto.com.br` (or the configured storefront URL) and confirm the same product appears in search/listing — this is the check that the accepted "published on real storefront" design decision actually works end-to-end.

- [ ] **Step 7: Re-run the script to verify idempotency**

Run: `npx medusa exec ./src/scripts/import-nuvemshop.ts` again.
Expected: log shows the same seller reused ("Seller já existia"), the same category count with none re-created, and `Importados: 0, já existentes (skip): N` — confirming no duplicates were created.

- [ ] **Step 8: Update HANDOFF.md with the outcome**

Add a short entry to `HANDOFF.md` (per the user's global workflow conventions) noting: migration ran on `<date>`, `<N>` products imported, seller id, any products that failed and need manual follow-up.
