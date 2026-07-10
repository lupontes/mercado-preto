# ProductCard Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three independently-maintained `ProductCard()` definitions in the storefront with a single shared `ProductCard` component.

**Architecture:** Extract a new `apps/storefront/src/components/product/ProductCard.tsx` server component with `product` and optional `sizes` props, matching the union of the three existing implementations' behavior per the approved spec. Update the three call sites to import it and delete their local definitions.

**Tech Stack:** Next.js 15 (App Router, React 19 server components), TypeScript, Vitest + @testing-library/react for tests, Tailwind CSS for styling.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-product-card-unification-design.md`
- Fallback text when no BRL price exists: always `"Consulte o preço"` (spec decision 1).
- Image `sizes` prop: optional, defaults to `"(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"`; `loja/[id]/page.tsx` passes `"(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"` explicitly (spec decision 2).
- Container always has `bg-white` (spec decision 3).
- `SellerCard` duplication is explicitly out of scope (spec "Fora de escopo").
- No changes to the `Product` type or `formatPrice()` in `apps/storefront/src/lib/api.ts`.
- Branch: `feature/product-card-unification` (already created, based on `develop`). Do not commit to `main`, `develop`, or any protected branch directly.
- Every task ends with a commit using Conventional Commits format (`type(scope): description`, imperative, lowercase, no trailing period).

---

### Task 1: Create the shared ProductCard component with tests

**Files:**
- Create: `apps/storefront/src/components/product/ProductCard.tsx`
- Test: `apps/storefront/src/components/product/__tests__/ProductCard.test.tsx`

**Interfaces:**
- Consumes: `formatPrice(amount: number, currency?: string): string` and `type Product` from `@/lib/api` (existing, unchanged — `Product` has `id: string, title: string, handle: string, description?: string, thumbnail?: string, status: string, variants?: Array<{ id: string, title: string, prices?: Array<{ amount: number, currency_code: string }> }>`).
- Produces: `export function ProductCard({ product, sizes }: { product: Product; sizes?: string })` — a JSX server component. Later tasks (2, 3, 4) import this exact name and prop shape.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/src/components/product/__tests__/ProductCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProductCard } from "../ProductCard"
import { formatPrice, type Product } from "@/lib/api"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const baseProduct: Product = {
  id: "prod_1",
  title: "Colar Artesanal",
  handle: "colar-artesanal",
  status: "published",
  thumbnail: "https://example.com/colar.jpg",
  variants: [
    {
      id: "variant_1",
      title: "Default",
      prices: [{ amount: 4990, currency_code: "brl" }],
    },
  ],
}

describe("ProductCard", () => {
  it("renders the product title and thumbnail image", () => {
    render(<ProductCard product={baseProduct} />)

    expect(screen.getByText("Colar Artesanal")).toBeInTheDocument()
    const img = screen.getByRole("img", { name: "Colar Artesanal" })
    expect(img).toHaveAttribute("src", "https://example.com/colar.jpg")
  })

  it("renders the formatted BRL price when available", () => {
    render(<ProductCard product={baseProduct} />)

    expect(screen.getByText(formatPrice(4990))).toBeInTheDocument()
  })

  it("renders a fallback message when there is no BRL price", () => {
    const productWithoutBrl: Product = {
      ...baseProduct,
      variants: [
        {
          id: "variant_1",
          title: "Default",
          prices: [{ amount: 4990, currency_code: "usd" }],
        },
      ],
    }

    render(<ProductCard product={productWithoutBrl} />)

    expect(screen.getByText("Consulte o preço")).toBeInTheDocument()
  })

  it("links to the product detail page using the product handle", () => {
    render(<ProductCard product={baseProduct} />)

    expect(screen.getByRole("link")).toHaveAttribute("href", "/produto/colar-artesanal")
  })

  it("passes the sizes prop through to the image, defaulting when omitted", () => {
    const { rerender } = render(<ProductCard product={baseProduct} sizes="100vw" />)
    expect(screen.getByRole("img", { name: "Colar Artesanal" })).toHaveAttribute("sizes", "100vw")

    rerender(<ProductCard product={baseProduct} />)
    expect(screen.getByRole("img", { name: "Colar Artesanal" })).toHaveAttribute(
      "sizes",
      "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/storefront && npx vitest run src/components/product/__tests__/ProductCard.test.tsx`
Expected: FAIL — `Failed to resolve import "../ProductCard"` (the component file doesn't exist yet).

- [ ] **Step 3: Write the component implementation**

Create `apps/storefront/src/components/product/ProductCard.tsx`:

```tsx
import Link from 'next/link'
import Image from 'next/image'
import { formatPrice, type Product } from '@/lib/api'

const DEFAULT_SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw'

type ProductCardProps = {
  product: Product
  sizes?: string
}

export function ProductCard({ product, sizes = DEFAULT_SIZES }: ProductCardProps) {
  const price = product.variants?.[0]?.prices?.find((p) => p.currency_code === 'brl')

  return (
    <Link
      href={`/produto/${product.handle}`}
      className="group rounded-xl border border-sand-dark overflow-hidden hover:shadow-md hover:border-amber transition-all bg-white"
    >
      <div className="aspect-square relative bg-sand">
        {product.thumbnail ? (
          <Image
            src={product.thumbnail}
            alt={product.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes={sizes}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-onyx/20">
            🛍️
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-onyx leading-tight group-hover:text-amber transition-colors line-clamp-2">
          {product.title}
        </h3>
        {price ? (
          <p className="font-display font-bold text-terracotta mt-2">
            {formatPrice(price.amount)}
          </p>
        ) : (
          <p className="text-sm text-onyx/40 mt-2">Consulte o preço</p>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/storefront && npx vitest run src/components/product/__tests__/ProductCard.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/components/product/ProductCard.tsx apps/storefront/src/components/product/__tests__/ProductCard.test.tsx
git commit -m "feat(storefront): add shared ProductCard component"
```

---

### Task 2: Migrate `loja/[id]/page.tsx` to the shared ProductCard

**Files:**
- Modify: `apps/storefront/src/app/loja/[id]/page.tsx`

**Interfaces:**
- Consumes: `ProductCard` from Task 1 (`import { ProductCard } from '@/components/product/ProductCard'`), signature `{ product: Product; sizes?: string }`.
- Produces: nothing new — this task only removes code and rewires an import.

- [ ] **Step 1: Remove the local `ProductCard` definition and unused imports, add the shared import**

In `apps/storefront/src/app/loja/[id]/page.tsx`:

Replace the import block (lines 1–6):

```tsx
import { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getSeller, getSellerProducts, formatPrice, type Product } from '@/lib/api'
import { MapPin, Tag, ArrowLeft } from 'lucide-react'
```

with:

```tsx
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSeller, getSellerProducts, type Product } from '@/lib/api'
import { MapPin, Tag, ArrowLeft } from 'lucide-react'
import { ProductCard } from '@/components/product/ProductCard'
```

(`Image` and `formatPrice` are removed — they were only used inside the local `ProductCard`, which this task deletes. `Link`, `notFound`, `getSeller`, `getSellerProducts`, `type Product`, and the `lucide-react` icons are still used elsewhere in this file and must stay.)

Replace the product grid usage:

```tsx
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
```

with:

```tsx
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              />
            ))}
          </div>
```

Delete the local `ProductCard` function entirely (the block starting at `function ProductCard({ product }: { product: Product }) {` through its closing `}`, i.e. what was lines 115–150 before this edit).

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: no errors referencing `apps/storefront/src/app/loja/[id]/page.tsx`.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `cd apps/storefront && npm test`
Expected: PASS — all existing tests plus the 5 new `ProductCard` tests green.

- [ ] **Step 4: Commit**

```bash
git add apps/storefront/src/app/loja/\[id\]/page.tsx
git commit -m "refactor(storefront): use shared ProductCard in seller page"
```

---

### Task 3: Migrate `produtos/page.tsx` to the shared ProductCard

**Files:**
- Modify: `apps/storefront/src/app/produtos/page.tsx`

**Interfaces:**
- Consumes: `ProductCard` from Task 1 (`import { ProductCard } from '@/components/product/ProductCard'`), signature `{ product: Product; sizes?: string }`. This page does not pass `sizes` — its current `16vw` value matches the component's default.
- Produces: nothing new.

- [ ] **Step 1: Remove the local `ProductCard` definition and unused imports, add the shared import**

In `apps/storefront/src/app/produtos/page.tsx`:

Replace the import block (lines 1–5):

```tsx
import { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { listCategories, listProducts, formatPrice, type Product } from '@/lib/api'
import { formatCategoryName } from '@/lib/format'
```

with:

```tsx
import { Metadata } from 'next'
import Link from 'next/link'
import { listCategories, listProducts, type Product } from '@/lib/api'
import { formatCategoryName } from '@/lib/format'
import { ProductCard } from '@/components/product/ProductCard'
```

(`Image` and `formatPrice` are removed — only used inside the local `ProductCard`. `Link`, `listCategories`, `listProducts`, `type Product`, and `formatCategoryName` are still used elsewhere and must stay.)

The product grid usage does not need to change — it already matches the shared component's signature:

```tsx
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
```

Delete the local `ProductCard` function entirely (the block starting at `function ProductCard({ product }: { product: Product }) {` through its closing `}`, i.e. what was lines 125–162 before this edit).

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: no errors referencing `apps/storefront/src/app/produtos/page.tsx`.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `cd apps/storefront && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/storefront/src/app/produtos/page.tsx
git commit -m "refactor(storefront): use shared ProductCard in products listing page"
```

---

### Task 4: Migrate `FeaturedProducts.tsx` to the shared ProductCard

**Files:**
- Modify: `apps/storefront/src/components/product/FeaturedProducts.tsx`

**Interfaces:**
- Consumes: `ProductCard` from Task 1, imported with a relative path since both files live in `apps/storefront/src/components/product/` (`import { ProductCard } from './ProductCard'`), signature `{ product: Product; sizes?: string }`. This file does not pass `sizes` — its current `16vw` value matches the component's default.
- Produces: nothing new.

**Note:** this is the one call site where the fallback text visibly changes for end users — today it renders `"Ver preço"` when there's no BRL price; after this change it renders `"Consulte o preço"` (per spec decision 1).

- [ ] **Step 1: Remove the local `ProductCard` definition and unused imports, add the shared import**

In `apps/storefront/src/components/product/FeaturedProducts.tsx`:

Replace the import block (lines 1–3):

```tsx
import Link from 'next/link'
import Image from 'next/image'
import { listProducts, formatPrice, type Product } from '@/lib/api'
```

with:

```tsx
import Link from 'next/link'
import { listProducts, type Product } from '@/lib/api'
import { ProductCard } from './ProductCard'
```

(`Image` and `formatPrice` are removed — only used inside the local `ProductCard`. `Link` stays: `FeaturedProducts` itself uses it for the "Ver todos →" anchor at line 29. `listProducts` and `type Product` stay — used by `getProducts()`.)

The product grid usage does not need to change:

```tsx
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
```

Delete the local `ProductCard` function entirely (the block starting at `function ProductCard({ product }: { product: Product }) {` through its closing `}`, i.e. what was lines 47–84 before this edit).

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: no errors referencing `apps/storefront/src/components/product/FeaturedProducts.tsx`.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `cd apps/storefront && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/storefront/src/components/product/FeaturedProducts.tsx
git commit -m "refactor(storefront): use shared ProductCard in featured products section"
```

---

### Task 5: Final verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Confirm no remaining local `ProductCard` definitions**

Run: `cd apps/storefront && grep -rn "function ProductCard" src/ | grep -v "src/components/product/ProductCard.tsx"`
Expected: no output. (The unfiltered grep matches one line — the `export function ProductCard` in `src/components/product/ProductCard.tsx` itself, which is correct and expected. Filtering it out should leave nothing, confirming no local redefinitions remain in `loja/[id]/page.tsx`, `produtos/page.tsx`, or `FeaturedProducts.tsx`.)

- [ ] **Step 2: Run the full test suite**

Run: `cd apps/storefront && npm test`
Expected: PASS — every test in the suite, including the 5 new `ProductCard` tests.

- [ ] **Step 3: Run the full typecheck**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the production build (matches the CI job)**

Run: `cd apps/storefront && NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000 NEXT_PUBLIC_PUBLISHABLE_KEY=pk_placeholder_for_ci npm run build`
Expected: build succeeds with no type or lint errors (mirrors the `storefront` job in `.github/workflows/ci.yml`).

- [ ] **Step 5: Commit if any cleanup was needed**

If steps 1–4 required no code changes, there is nothing to commit — this task is verification-only. If a fix was needed, commit it with an appropriate `fix(storefront): ...` message before proceeding.
