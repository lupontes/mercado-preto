# Categoria no Cadastro/Edição de Produto do Lojista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seller choose, view, and change the product category from the seller panel (`painel/produtos`), closing the platform gap documented in `docs/superpowers/specs/2026-07-04-seller-product-category-design.md`.

**Architecture:** The Medusa `ProductModuleService` already accepts `category_ids` natively on `createProducts`/`updateProducts` — no workflow or manual link table management needed. Backend routes gain a `category_id` field (singular, mapped internally to the array Medusa expects) plus a shared existence-validation helper. The frontend gets one new reusable `CategorySelect` component wired into the three existing seller-panel product pages, sourcing its options from the public `/store/product-categories` endpoint the storefront already uses.

**Tech Stack:** Medusa v2 (`@medusajs/framework/utils`, Zod), Jest + `@swc/jest` (backend unit tests), Next.js 15 / React 19 (frontend, no new test infra).

## Global Constraints

- One category per product (not multiple).
- Sellers only pick from existing admin-curated categories — no seller-side category creation.
- Category is optional — a product can be saved without one.
- Backend changes must use the existing `productService.createProducts`/`updateProducts`/`listProductCategories`/`listProducts` module-service calls — do not introduce `createProductsWorkflow` or manual `remoteLink` category management.
- No React Testing Library or other component-testing infrastructure is introduced in this feature (explicit, user-approved scope decision — see spec's "Testes" section). Frontend tasks are verified manually in the browser instead of with automated tests.
- All new code, identifiers, and comments in English (backend and frontend files use pt-BR only in user-facing copy/strings, matching existing files).

---

### Task 1: Shared category-existence validation helper

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/seller/products/category-validation.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/seller/products/__tests__/category-validation.unit.spec.ts`

**Interfaces:**
- Produces: `categoryExists(productService: { listProductCategories(filters: { id: string[] }): Promise<unknown[]> }, categoryId: string): Promise<boolean>` — used by Task 2 (POST) and Task 3 (PATCH) to validate `category_id` before writing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/medusa-backend/apps/backend/src/api/seller/products/__tests__/category-validation.unit.spec.ts
import { categoryExists } from "../category-validation"

describe("categoryExists", () => {
  it("returns true when the category is found", async () => {
    const productService = {
      listProductCategories: jest.fn().mockResolvedValue([{ id: "pcat_1" }]),
    }

    const result = await categoryExists(productService, "pcat_1")

    expect(result).toBe(true)
    expect(productService.listProductCategories).toHaveBeenCalledWith({ id: ["pcat_1"] })
  })

  it("returns false when the category is not found", async () => {
    const productService = {
      listProductCategories: jest.fn().mockResolvedValue([]),
    }

    const result = await categoryExists(productService, "pcat_missing")

    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit src/api/seller/products/__tests__/category-validation.unit.spec.ts`
Expected: FAIL — `Cannot find module '../category-validation'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/medusa-backend/apps/backend/src/api/seller/products/category-validation.ts
type ProductCategoryLister = {
  listProductCategories(filters: { id: string[] }): Promise<unknown[]>
}

export async function categoryExists(
  productService: ProductCategoryLister,
  categoryId: string
): Promise<boolean> {
  const categories = await productService.listProductCategories({ id: [categoryId] })
  return categories.length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit src/api/seller/products/__tests__/category-validation.unit.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/seller/products/category-validation.ts packages/medusa-backend/apps/backend/src/api/seller/products/__tests__/category-validation.unit.spec.ts
git commit -m "feat(seller): add category-existence validation helper"
```

---

### Task 2: `POST /seller/products` accepts `category_id`, `GET` returns categories

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/seller/products/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/seller/products/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `categoryExists(productService, categoryId)` from Task 1.
- Produces: `CreateProductSchema` now has `category_id?: string`; `POST` passes `category_ids?: string[]` to `productService.createProducts`; `GET` includes `products.categories.id`/`products.categories.name` in the `query.graph` fields.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/medusa-backend/apps/backend/src/api/seller/products/__tests__/route.unit.spec.ts
import { GET, POST } from "../route"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

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

describe("GET /seller/products", () => {
  it("requests categories id and name for each product", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", products: [] }] })
    const req = {
      sellerId: "seller_1",
      query: {},
      scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(graph).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.arrayContaining(["products.categories.id", "products.categories.name"]),
    }))
  })
})

describe("POST /seller/products", () => {
  const validBody = {
    title: "Produto teste",
    variants: [{ title: "Default", prices: [{ amount: 1000, currency_code: "brl" }] }],
  }

  it("passes category_ids to createProducts when category_id is valid", async () => {
    const createProducts = jest.fn().mockResolvedValue([{ id: "prod_1" }])
    const listProductCategories = jest.fn().mockResolvedValue([{ id: "pcat_1" }])
    const linkCreate = jest.fn().mockResolvedValue(undefined)
    const req = {
      sellerId: "seller_1",
      body: { ...validBody, category_id: "pcat_1" },
      scope: makeScope({
        [Modules.PRODUCT]: { createProducts, listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: linkCreate },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(listProductCategories).toHaveBeenCalledWith({ id: ["pcat_1"] })
    expect(createProducts).toHaveBeenCalledWith([expect.objectContaining({ category_ids: ["pcat_1"] })])
    expect(res._status).toBe(201)
  })

  it("omits category_ids when category_id is not provided", async () => {
    const createProducts = jest.fn().mockResolvedValue([{ id: "prod_1" }])
    const listProductCategories = jest.fn()
    const linkCreate = jest.fn().mockResolvedValue(undefined)
    const req = {
      sellerId: "seller_1",
      body: validBody,
      scope: makeScope({
        [Modules.PRODUCT]: { createProducts, listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: linkCreate },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(listProductCategories).not.toHaveBeenCalled()
    expect(createProducts).toHaveBeenCalledWith([expect.objectContaining({ category_ids: undefined })])
    expect(res._status).toBe(201)
  })

  it("returns 400 and does not create the product when category_id does not exist", async () => {
    const createProducts = jest.fn()
    const listProductCategories = jest.fn().mockResolvedValue([])
    const req = {
      sellerId: "seller_1",
      body: { ...validBody, category_id: "pcat_missing" },
      scope: makeScope({
        [Modules.PRODUCT]: { createProducts, listProductCategories },
        [ContainerRegistrationKeys.LINK]: { create: jest.fn() },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Categoria não encontrada" })
    expect(createProducts).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit src/api/seller/products/__tests__/route.unit.spec.ts`
Expected: FAIL — the "requests categories id and name" and "category_id" assertions fail because `route.ts` doesn't send those fields yet.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `packages/medusa-backend/apps/backend/src/api/seller/products/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../modules/seller"
import { categoryExists } from "./category-validation"

const CreateProductSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  handle: z.string().optional(),
  thumbnail: z.string().url().optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  category_id: z.string().optional(),
  variants: z.array(z.object({
    title: z.string().default("Default"),
    sku: z.string().optional(),
    prices: z.array(z.object({
      amount: z.number().int().positive(),
      currency_code: z.string().length(3).default("brl"),
    })).default([]),
  })).default([{ title: "Default", prices: [] }]),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { limit = 20, offset = 0 } = req.query as Record<string, string>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: [
      "id",
      "products.id",
      "products.title",
      "products.handle",
      "products.thumbnail",
      "products.status",
      "products.description",
      "products.created_at",
      "products.categories.id",
      "products.categories.name",
    ],
    filters: { id: sellerId },
  })

  const products = sellers?.[0]?.products ?? []
  const paginated = products.slice(Number(offset), Number(offset) + Number(limit))
  res.json({ products: paginated, count: products.length, limit: Number(limit), offset: Number(offset) })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId

  const parsed = CreateProductSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const productService = req.scope.resolve(Modules.PRODUCT)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  if (parsed.data.category_id && !(await categoryExists(productService, parsed.data.category_id))) {
    return res.status(400).json({ error: "Categoria não encontrada" })
  }

  let product: any
  try {
    const [created] = await productService.createProducts([{
      title: parsed.data.title,
      description: parsed.data.description,
      handle: parsed.data.handle,
      thumbnail: parsed.data.thumbnail,
      status: parsed.data.status as any,
      category_ids: parsed.data.category_id ? [parsed.data.category_id] : undefined,
      variants: parsed.data.variants.map((v: any) => ({
        title: v.title,
        ...(v.sku ? { sku: v.sku } : {}),
      })),
    }])
    product = created
  } catch (err: any) {
    console.error("[seller/products POST] createProducts error:", err?.message)
    return res.status(500).json({ error: "Erro ao criar produto", details: err?.message })
  }

  try {
    await remoteLink.create([{
      [SELLER_MODULE]: { seller_id: sellerId },
      [Modules.PRODUCT]: { product_id: product.id },
    }])
  } catch (err: any) {
    return res.status(500).json({ error: "Produto criado mas vínculo falhou", productId: product.id, details: err?.message })
  }

  res.status(201).json({ product })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit src/api/seller/products/__tests__/route.unit.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/seller/products/route.ts packages/medusa-backend/apps/backend/src/api/seller/products/__tests__/route.unit.spec.ts
git commit -m "feat(seller): accept category_id on product creation, return categories on list"
```

---

### Task 3: `PATCH /seller/products/:id` accepts `category_id`, `GET` detail returns categories

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/seller/products/[id]/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/seller/products/[id]/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `categoryExists(productService, categoryId)` from Task 1.
- Produces: `UpdateProductSchema` now has `category_id?: string | null`; `PATCH` maps it to `category_ids` only when the key is present in the raw request body (three-state semantics: absent = unchanged, `null` = cleared, string = set); `GET` (detail) requests the `categories` relation.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/medusa-backend/apps/backend/src/api/seller/products/[id]/__tests__/route.unit.spec.ts
import { GET, PATCH } from "../route"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

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

const linkedGraph = jest.fn().mockResolvedValue({ data: [{ id: "seller_1", products: [{ id: "prod_1" }] }] })

describe("GET /seller/products/:id", () => {
  it("requests the categories relation", async () => {
    const listProducts = jest.fn().mockResolvedValue([{ id: "prod_1", categories: [] }])
    const req = {
      sellerId: "seller_1",
      params: { id: "prod_1" },
      scope: makeScope({
        [ContainerRegistrationKeys.QUERY]: { graph: linkedGraph },
        [Modules.PRODUCT]: { listProducts },
      }),
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(listProducts).toHaveBeenCalledWith({ id: ["prod_1"] }, { relations: ["categories"] })
    expect(res._status).toBe(200)
  })
})

describe("PATCH /seller/products/:id", () => {
  function makeReq(body: unknown, serviceOverrides: Record<string, unknown> = {}) {
    return {
      sellerId: "seller_1",
      params: { id: "prod_1" },
      body,
      scope: makeScope({
        [ContainerRegistrationKeys.QUERY]: { graph: linkedGraph },
        [Modules.PRODUCT]: {
          updateProducts: jest.fn().mockResolvedValue({ id: "prod_1" }),
          listProductCategories: jest.fn().mockResolvedValue([{ id: "pcat_1" }]),
          ...serviceOverrides,
        },
      }),
    } as any
  }

  it("sets category_ids when category_id is a valid string", async () => {
    const updateProducts = jest.fn().mockResolvedValue({ id: "prod_1" })
    const req = makeReq({ category_id: "pcat_1" }, { updateProducts })
    const res = makeRes()

    await PATCH(req, res)

    expect(updateProducts).toHaveBeenCalledWith("prod_1", expect.objectContaining({ category_ids: ["pcat_1"] }))
    expect(res._status).toBe(200)
  })

  it("clears category_ids when category_id is null", async () => {
    const updateProducts = jest.fn().mockResolvedValue({ id: "prod_1" })
    const req = makeReq({ category_id: null }, { updateProducts })
    const res = makeRes()

    await PATCH(req, res)

    expect(updateProducts).toHaveBeenCalledWith("prod_1", expect.objectContaining({ category_ids: [] }))
  })

  it("does not touch category_ids when category_id is absent from the body", async () => {
    const updateProducts = jest.fn().mockResolvedValue({ id: "prod_1" })
    const req = makeReq({ title: "Novo título" }, { updateProducts })
    const res = makeRes()

    await PATCH(req, res)

    const [, updateData] = updateProducts.mock.calls[0]
    expect(updateData).not.toHaveProperty("category_ids")
  })

  it("returns 400 and does not update when category_id does not exist", async () => {
    const updateProducts = jest.fn()
    const listProductCategories = jest.fn().mockResolvedValue([])
    const req = makeReq({ category_id: "pcat_missing" }, { updateProducts, listProductCategories })
    const res = makeRes()

    await PATCH(req, res)

    expect(res._status).toBe(400)
    expect(updateProducts).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit "src/api/seller/products/\[id\]/__tests__/route.unit.spec.ts"`
Expected: FAIL — the relations/category_ids assertions fail because `[id]/route.ts` doesn't handle `category_id` yet.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `packages/medusa-backend/apps/backend/src/api/seller/products/[id]/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../../modules/seller"
import { categoryExists } from "../category-validation"

const UpdateProductSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().optional(),
  thumbnail: z.string().url().optional(),
  status: z.enum(["draft", "published"]).optional(),
  category_id: z.string().nullable().optional(),
})

async function getSellerProduct(req: MedusaRequest, sellerId: string, productId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["products.id"],
    filters: { id: sellerId },
  })
  const products = sellers?.[0]?.products ?? []
  return products.find((p: any) => p.id === productId)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params

  const linked = await getSellerProduct(req, sellerId, id)
  if (!linked) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  const productService = req.scope.resolve(Modules.PRODUCT)
  const [product] = await productService.listProducts({ id: [id] }, { relations: ["categories"] })
  res.json({ product })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params

  const linked = await getSellerProduct(req, sellerId, id)
  if (!linked) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  const parsed = UpdateProductSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const productService = req.scope.resolve(Modules.PRODUCT)

  const { category_id, ...rest } = parsed.data
  const updateData: Record<string, unknown> = { ...rest }
  if (req.body && typeof req.body === "object" && "category_id" in (req.body as Record<string, unknown>)) {
    if (category_id && !(await categoryExists(productService, category_id))) {
      return res.status(400).json({ error: "Categoria não encontrada" })
    }
    updateData.category_ids = category_id ? [category_id] : []
  }

  const product = await productService.updateProducts(id, updateData as any)
  res.json({ product })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId
  const { id } = req.params

  const linked = await getSellerProduct(req, sellerId, id)
  if (!linked) return res.status(404).json({ error: "Produto não encontrado nesta loja" })

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)
  await remoteLink.dismiss([{
    [SELLER_MODULE]: { seller_id: sellerId },
    [Modules.PRODUCT]: { product_id: id },
  }])

  res.json({ message: "Produto removido da loja" })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit "src/api/seller/products/\[id\]/__tests__/route.unit.spec.ts"`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full backend unit suite to check for regressions**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit`
Expected: PASS, no new failures beyond the 2 pre-existing TypeScript-unrelated errors already documented in `HANDOFF.md` (`import-nuvemshop.ts`, `client.unit.spec.ts` — unrelated to this feature).

- [ ] **Step 6: Commit**

```bash
git add "packages/medusa-backend/apps/backend/src/api/seller/products/[id]/route.ts" "packages/medusa-backend/apps/backend/src/api/seller/products/[id]/__tests__/route.unit.spec.ts"
git commit -m "feat(seller): accept category_id on product update, return category on detail"
```

---

### Task 4: `CategorySelect` component

**Files:**
- Create: `apps/storefront/src/components/product/CategorySelect.tsx`

**Interfaces:**
- Consumes: `listCategories(): Promise<{ product_categories: Category[]; count: number }>` and `type Category = { id: string; name: string; handle: string }`, both already exported from `apps/storefront/src/lib/api.ts`.
- Produces: `CategorySelect({ value, onChange }: { value: string; onChange: (categoryId: string) => void })` — a controlled `<select>`, consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the component**

```tsx
// apps/storefront/src/components/product/CategorySelect.tsx
'use client'

import { useEffect, useState } from 'react'
import { listCategories, type Category } from '@/lib/api'

type CategorySelectProps = {
  value: string
  onChange: (categoryId: string) => void
}

export function CategorySelect({ value, onChange }: CategorySelectProps) {
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    listCategories()
      .then((data) => setCategories(data.product_categories))
      .catch(() => setCategories([]))
  }, [])

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">Sem categoria</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/components/product/CategorySelect.tsx
git commit -m "feat(painel): add reusable CategorySelect component"
```

---

### Task 5: Wire `CategorySelect` into product creation

**Files:**
- Modify: `apps/storefront/src/app/painel/produtos/novo/page.tsx`

**Interfaces:**
- Consumes: `CategorySelect` from Task 4; `createSellerProduct(token, data)` already accepts an arbitrary `Record<string, unknown>` body (`apps/storefront/src/lib/seller-api.ts:61`), so no signature change needed — it now also passes `category_id`.

- [ ] **Step 1: Replace the full contents of the file**

```tsx
// apps/storefront/src/app/painel/produtos/novo/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { createSellerProduct } from '@/lib/seller-api'
import { CategorySelect } from '@/components/product/CategorySelect'
import { ArrowLeft, Loader2 } from 'lucide-react'

export default function NovoProdutoPage() {
  const { token } = useSellerStore()
  const router = useRouter()

  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'draft' as 'draft' | 'published',
    thumbnail: '',
    price: '',
    sku: '',
    category_id: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setLoading(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await createSellerProduct(token, {
        title: form.title,
        description: form.description || undefined,
        status: form.status,
        thumbnail: form.thumbnail || undefined,
        category_id: form.category_id || undefined,
        variants: [
          {
            title: 'Padrão',
            sku: form.sku || undefined,
            prices: [{ amount: priceAmount, currency_code: 'brl' }],
          },
        ],
      })

      router.push('/painel/produtos')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar produto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/painel/produtos" className="text-onyx/40 hover:text-amber transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-black text-onyx">Novo produto</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-sand-dark p-6 space-y-5">
        <Field label="Título do produto" required>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} className="input" required />
        </Field>

        <Field label="Descrição">
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="input min-h-[100px] resize-y"
            placeholder="Conte sobre o produto, materiais, técnica artesanal..."
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Preço (R$)" required>
            <input
              type="text"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              className="input"
              placeholder="0,00"
              required
            />
          </Field>
          <Field label="SKU / Código">
            <input value={form.sku} onChange={(e) => set('sku', e.target.value)} className="input" placeholder="Opcional" />
          </Field>
        </div>

        <Field label="Categoria">
          <CategorySelect value={form.category_id} onChange={(value) => set('category_id', value)} />
        </Field>

        <Field label="URL da imagem principal">
          <input
            type="url"
            value={form.thumbnail}
            onChange={(e) => set('thumbnail', e.target.value)}
            className="input"
            placeholder="https://..."
          />
          <p className="text-xs text-onyx/40 mt-1">Cole a URL de uma imagem hospedada (ex: Google Drive, Imgur)</p>
        </Field>

        <Field label="Visibilidade">
          <select value={form.status} onChange={(e) => set('status', e.target.value as 'draft' | 'published')} className="input">
            <option value="draft">Rascunho (não aparece na loja)</option>
            <option value="published">Publicado (visível para clientes)</option>
          </select>
        </Field>

        {error && (
          <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <Link
            href="/painel/produtos"
            className="rounded-xl border border-sand-dark px-5 py-2.5 text-sm font-semibold text-onyx/60 hover:border-amber transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-xl bg-amber py-2.5 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar produto
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-onyx/60 mb-1">
        {label} {required && <span className="text-terracotta">*</span>}
      </label>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

1. Ensure Postgres, backend (`cd packages/medusa-backend/apps/backend && npx medusa develop`) and storefront (`cd apps/storefront && npm run dev`) are running.
2. Log in to `/painel/login` with an existing approved seller account (or register one via `/painel/cadastro` and approve it from the Medusa admin if none exists locally).
3. Go to `/painel/produtos/novo`, fill in title + price, pick a category from the new "Categoria" select, submit.
4. Confirm the product appears in `/painel/produtos` (category column added in Task 7 will show it) and, in the Medusa admin (Products → the new product → Organize), that the category is linked.
5. Repeat once leaving "Sem categoria" selected — confirm the product is created with no category and no error.

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/app/painel/produtos/novo/page.tsx
git commit -m "feat(painel): let seller pick a category when creating a product"
```

---

### Task 6: Wire `CategorySelect` into product editing

**Files:**
- Modify: `apps/storefront/src/app/painel/produtos/[id]/page.tsx`

**Interfaces:**
- Consumes: `CategorySelect` from Task 4; the `category_id` field on `updateSellerProduct(token, id, data)` (already accepts `Record<string, unknown>`, `apps/storefront/src/lib/seller-api.ts:68`); reads `product.categories?.[0]?.id` from the list response, which Task 2 now populates.

- [ ] **Step 1: Replace the full contents of the file**

```tsx
// apps/storefront/src/app/painel/produtos/[id]/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { getSellerProducts, updateSellerProduct } from '@/lib/seller-api'
import { CategorySelect } from '@/components/product/CategorySelect'
import { ArrowLeft, Loader2 } from 'lucide-react'

type ProductForm = {
  title: string
  description: string
  status: 'draft' | 'published'
  thumbnail: string
  price: string
  category_id: string
}

export default function EditarProdutoPage() {
  const { token } = useSellerStore()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [form, setForm] = useState<ProductForm>({
    title: '',
    description: '',
    status: 'draft',
    thumbnail: '',
    price: '',
    category_id: '',
  })
  const [variantId, setVariantId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !id) return
    getSellerProducts(token)
      .then((data) => {
        const products = data.products as any[]
        const product = products.find((p) => p.id === id)
        if (!product) {
          router.replace('/painel/produtos')
          return
        }
        const price = product.variants?.[0]?.prices?.find((p: any) => p.currency_code === 'brl')
        setVariantId(product.variants?.[0]?.id ?? null)
        setForm({
          title: product.title ?? '',
          description: product.description ?? '',
          status: product.status ?? 'draft',
          thumbnail: product.thumbnail ?? '',
          price: price ? String(price.amount / 100).replace('.', ',') : '',
          category_id: product.categories?.[0]?.id ?? '',
        })
      })
      .finally(() => setLoadingData(false))
  }, [token, id, router])

  function set(field: keyof ProductForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !id) return
    setError('')
    setSaving(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await updateSellerProduct(token, id, {
        title: form.title,
        description: form.description || undefined,
        status: form.status,
        thumbnail: form.thumbnail || undefined,
        category_id: form.category_id || null,
        variants: variantId
          ? [{ id: variantId, prices: [{ amount: priceAmount, currency_code: 'brl' }] }]
          : undefined,
      })

      router.push('/painel/produtos')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar produto')
    } finally {
      setSaving(false)
    }
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/painel/produtos" className="text-onyx/40 hover:text-amber transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-black text-onyx">Editar produto</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-sand-dark p-6 space-y-5">
        <Field label="Título do produto" required>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} className="input" required />
        </Field>

        <Field label="Descrição">
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="input min-h-[100px] resize-y"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Preço (R$)" required>
            <input
              type="text"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              className="input"
              placeholder="0,00"
              required
            />
          </Field>
          <Field label="Visibilidade">
            <select value={form.status} onChange={(e) => set('status', e.target.value as 'draft' | 'published')} className="input">
              <option value="draft">Rascunho</option>
              <option value="published">Publicado</option>
            </select>
          </Field>
        </div>

        <Field label="Categoria">
          <CategorySelect value={form.category_id} onChange={(value) => set('category_id', value)} />
        </Field>

        <Field label="URL da imagem principal">
          <input
            type="url"
            value={form.thumbnail}
            onChange={(e) => set('thumbnail', e.target.value)}
            className="input"
            placeholder="https://..."
          />
        </Field>

        {error && (
          <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <Link
            href="/painel/produtos"
            className="rounded-xl border border-sand-dark px-5 py-2.5 text-sm font-semibold text-onyx/60 hover:border-amber transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-xl bg-amber py-2.5 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar alterações
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-onyx/60 mb-1">
        {label} {required && <span className="text-terracotta">*</span>}
      </label>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

1. With the same dev servers running, open `/painel/produtos`, click "Editar" on the product created in Task 5.
2. Confirm the "Categoria" select is pre-filled with the category chosen at creation.
3. Change it to a different category, save, reopen the edit page — confirm the new category persisted.
4. Change it to "Sem categoria", save, reopen — confirm the category was cleared (empty selection, not the old one).

- [ ] **Step 3: Commit**

```bash
git add "apps/storefront/src/app/painel/produtos/[id]/page.tsx"
git commit -m "feat(painel): let seller view and change a product's category when editing"
```

---

### Task 7: Show category in the product list

**Files:**
- Modify: `apps/storefront/src/app/painel/produtos/page.tsx`

**Interfaces:**
- Consumes: `product.categories?: Array<{ id: string; name: string }>`, already returned by the list endpoint since Task 2.

- [ ] **Step 1: Replace the full contents of the file**

```tsx
// apps/storefront/src/app/painel/produtos/page.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { getSellerProducts, deleteSellerProduct } from '@/lib/seller-api'
import { formatPrice } from '@/lib/api'
import { Plus, Pencil, Trash2, Loader2, Package } from 'lucide-react'

type Product = {
  id: string
  title: string
  status: string
  thumbnail?: string
  categories?: Array<{ id: string; name: string }>
  variants?: Array<{
    prices?: Array<{ amount: number; currency_code: string }>
  }>
}

export default function ProdutosPage() {
  const { token } = useSellerStore()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    if (!token) return
    try {
      const data = await getSellerProducts(token)
      setProducts(data.products as Product[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token])

  async function handleDelete(id: string) {
    if (!token || !confirm('Tem certeza que deseja excluir este produto?')) return
    setDeletingId(id)
    try {
      await deleteSellerProduct(token, id)
      setProducts((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao excluir produto')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-amber" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-onyx">Meus produtos</h1>
          <p className="text-onyx/50 text-sm mt-1">{products.length} produto(s)</p>
        </div>
        <Link
          href="/painel/produtos/novo"
          className="flex items-center gap-2 rounded-xl bg-amber px-4 py-2.5 font-semibold text-sm text-onyx hover:bg-amber-dark transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo produto
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-dark p-12 text-center">
          <Package className="h-12 w-12 text-onyx/20 mx-auto mb-4" />
          <p className="font-display font-bold text-onyx">Nenhum produto ainda</p>
          <p className="text-onyx/50 text-sm mt-1">
            Adicione seus primeiros produtos para que clientes possam encontrá-los.
          </p>
          <Link
            href="/painel/produtos/novo"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber px-4 py-2 font-semibold text-sm text-onyx hover:bg-amber-dark transition-colors"
          >
            <Plus className="h-4 w-4" />
            Adicionar produto
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sand border-b border-sand-dark">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60">Produto</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Categoria</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Preço</th>
                <th className="text-left px-4 py-3 font-semibold text-onyx/60 hidden sm:table-cell">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-onyx/60">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-dark">
              {products.map((product) => {
                const price = product.variants?.[0]?.prices?.find((p) => p.currency_code === 'brl')
                return (
                  <tr key={product.id} className="hover:bg-sand/40 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-onyx line-clamp-1">{product.title}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-onyx/70">
                      {product.categories?.[0]?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-onyx/70">
                      {price ? formatPrice(price.amount) : '—'}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/painel/produtos/${product.id}`}
                          className="p-2 rounded-lg text-onyx/40 hover:text-amber hover:bg-amber/10 transition-colors"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => handleDelete(product.id)}
                          disabled={deletingId === product.id}
                          className="p-2 rounded-lg text-onyx/40 hover:text-terracotta hover:bg-terracotta/10 transition-colors disabled:opacity-30"
                          title="Excluir"
                        >
                          {deletingId === product.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    published: { label: 'Publicado', className: 'bg-forest/10 text-forest' },
    draft: { label: 'Rascunho', className: 'bg-sand-dark text-onyx/60' },
    proposed: { label: 'Proposto', className: 'bg-amber/10 text-amber-dark' },
    rejected: { label: 'Rejeitado', className: 'bg-terracotta/10 text-terracotta' },
  }
  const { label, className } = map[status] ?? { label: status, className: 'bg-sand-dark text-onyx/60' }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  )
}
```

- [ ] **Step 2: Manual verification**

1. Open `/painel/produtos` (desktop width, so the `sm:table-cell` columns are visible).
2. Confirm the "Categoria" column shows the correct category name for the products from Tasks 5/6, and "—" for the one left without a category.
3. Shrink the viewport below the `sm` breakpoint — confirm the column hides along with Preço/Status, matching existing responsive behavior.

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/app/painel/produtos/page.tsx
git commit -m "feat(painel): show product category in the seller product list"
```

---

## Final Checks

- [ ] Run the full backend unit suite once more: `cd packages/medusa-backend/apps/backend && npm run test:unit` — expect the same pass count as before this feature plus the 11 new tests from Tasks 1–3 (2 + 4 + 5), with no regressions.
- [ ] Run `cd apps/storefront && npx tsc --noEmit` and `cd apps/storefront && npm run build` — expect clean build.
- [ ] Confirm `docker exec mercado-preto-db psql -U medusa -d mercado_preto -c "\d product_category_product"` (or equivalent) shows a row linking the product created in Task 5 to its category, if you want a database-level sanity check in addition to the admin UI.
