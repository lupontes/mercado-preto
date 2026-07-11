# Admin Seller Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Vendedores" screen to the Medusa admin dashboard so an administrator can approve, reject, suspend, and reactivate sellers without calling the API directly.

**Architecture:** Two new backend API routes (`reject`, `activate`) exposing service methods that already exist but have no route. Two new Medusa admin extension routes (list at `/app/sellers`, detail at `/app/sellers/:id`) built with `@medusajs/ui` components and a custom `@medusajs/js-sdk` client for authenticated fetch calls. New Vitest-based test infrastructure for `src/admin/`, kept separate from the backend's existing Jest setup by file-naming convention.

**Tech Stack:** Medusa v2 admin extensions (`@medusajs/admin-sdk`, `@medusajs/ui`, `@medusajs/js-sdk`), React 18, react-router-dom v6, TanStack Query v5, Zod (backend validation), Jest (backend tests), Vitest + `@testing-library/react` + jsdom (admin frontend tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-11-admin-seller-management-design.md`
- Reject sets seller status back to `pending` (not a new enum value), using the existing `SellerModuleService.rejectSeller(id, reason)`. Reason is required.
- Activate sets seller status to `active`, using the existing `SellerModuleService.activateSeller(id)`. No request body.
- Seller list on `/app/sellers` opens filtered to `status=pending` by default.
- Detail screen shows only profile + status + actions — no product list in this version.
- No new emails for reject/suspend/reactivate — only approval keeps its existing email.
- Admin frontend test files use the `.test.tsx` extension (never `.unit.spec.ts`/`.unit.spec.tsx`) — the backend's Jest `testMatch` is `**/src/**/__tests__/**/*.unit.spec.[jt]s`, which would otherwise also match files inside `src/admin/` and run React component tests under Jest's Node environment (no DOM), breaking them.
- Branch: `feature/admin-seller-management` (already created, based on `main`, spec already committed as `21f9e6f`). Do not commit to `main`, `develop`, or any protected branch directly.
- Every task ends with a commit using Conventional Commits format (`type(scope): description`, imperative, lowercase, no trailing period).

---

### Task 1: Backend — `reject` route

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/reject/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/reject/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `SellerModuleService.rejectSeller(id: string, reason: string): Promise<Seller>` (existing, in `packages/medusa-backend/apps/backend/src/modules/seller/service.ts`) and `SellerModuleService.listSellers(filters): Promise<Seller[]>` (existing).
- Produces: `POST /admin/sellers/:id/reject` — body `{ reason: string }`, responds `{ seller: Seller }` on success (200), `{ error: string }` on 400/404. Task 6 (frontend detail route) calls this exact path and body shape.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/reject/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"

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

describe("POST /admin/sellers/:id/reject", () => {
  it("rejects a pending seller with the given reason", async () => {
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", status: "pending" }])
    const rejectSeller = jest.fn().mockResolvedValue({ id: "seller_1", status: "pending", rejectionReason: "CNPJ inválido" })
    const req = {
      params: { id: "seller_1" },
      body: { reason: "CNPJ inválido" },
      scope: makeScope({ seller: { listSellers, rejectSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(rejectSeller).toHaveBeenCalledWith("seller_1", "CNPJ inválido")
    expect(res._status).toBe(200)
    expect(res._body).toEqual({ seller: { id: "seller_1", status: "pending", rejectionReason: "CNPJ inválido" } })
  })

  it("returns 400 and does not call rejectSeller when reason is missing", async () => {
    const listSellers = jest.fn()
    const rejectSeller = jest.fn()
    const req = {
      params: { id: "seller_1" },
      body: {},
      scope: makeScope({ seller: { listSellers, rejectSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
    expect(rejectSeller).not.toHaveBeenCalled()
  })

  it("returns 404 when the seller does not exist", async () => {
    const listSellers = jest.fn().mockResolvedValue([])
    const rejectSeller = jest.fn()
    const req = {
      params: { id: "seller_missing" },
      body: { reason: "CNPJ inválido" },
      scope: makeScope({ seller: { listSellers, rejectSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: "Vendedor não encontrado" })
    expect(rejectSeller).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/sellers/\[id\]/reject --silent --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../route'` (the route file doesn't exist yet).

- [ ] **Step 3: Write the route implementation**

Create `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/reject/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

const RejectSchema = z.object({
  reason: z.string().min(1, "Motivo é obrigatório"),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const parsed = RejectSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const [existing] = await sellerService.listSellers({ id })
  if (!existing) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  const seller = await sellerService.rejectSeller(id, parsed.data.reason)
  res.json({ seller })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/sellers/\[id\]/reject --silent --runInBand --forceExit`
Expected: PASS — 3/3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/sellers/\[id\]/reject
git commit -m "feat(backend): add POST /admin/sellers/:id/reject route"
```

---

### Task 2: Backend — `activate` route

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/activate/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/activate/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `SellerModuleService.activateSeller(id: string): Promise<Seller>` (existing) and `listSellers` (existing).
- Produces: `POST /admin/sellers/:id/activate` — no body, responds `{ seller: Seller }` on success (200), `{ error: string }` on 404. Task 6 calls this exact path.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/activate/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"

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

describe("POST /admin/sellers/:id/activate", () => {
  it("activates a suspended seller", async () => {
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", status: "suspended" }])
    const activateSeller = jest.fn().mockResolvedValue({ id: "seller_1", status: "active" })
    const req = {
      params: { id: "seller_1" },
      scope: makeScope({ seller: { listSellers, activateSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(activateSeller).toHaveBeenCalledWith("seller_1")
    expect(res._status).toBe(200)
    expect(res._body).toEqual({ seller: { id: "seller_1", status: "active" } })
  })

  it("returns 404 when the seller does not exist", async () => {
    const listSellers = jest.fn().mockResolvedValue([])
    const activateSeller = jest.fn()
    const req = {
      params: { id: "seller_missing" },
      scope: makeScope({ seller: { listSellers, activateSeller } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: "Vendedor não encontrado" })
    expect(activateSeller).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/sellers/\[id\]/activate --silent --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Write the route implementation**

Create `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/activate/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const { id } = req.params

  const [existing] = await sellerService.listSellers({ id })
  if (!existing) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  const seller = await sellerService.activateSeller(id)
  res.json({ seller })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/sellers/\[id\]/activate --silent --runInBand --forceExit`
Expected: PASS — 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/sellers/\[id\]/activate
git commit -m "feat(backend): add POST /admin/sellers/:id/activate route"
```

---

### Task 3: Admin frontend test infrastructure

**Files:**
- Modify: `packages/medusa-backend/apps/backend/package.json`
- Create: `packages/medusa-backend/apps/backend/src/admin/vitest.config.ts`
- Create: `packages/medusa-backend/apps/backend/src/admin/vitest.setup.ts`
- Create: `packages/medusa-backend/apps/backend/src/admin/lib/__tests__/smoke.test.tsx`

**Interfaces:**
- Produces: `npm run test:admin` script that runs Vitest scoped to `src/admin/`. Every later admin frontend test file must use the `.test.tsx` extension and live under a `__tests__/` directory to be picked up.

- [ ] **Step 1: Add dependencies to package.json**

In `packages/medusa-backend/apps/backend/package.json`, add to `"dependencies"` (find the existing block and add these two lines — they're currently only transitive via `@medusajs/dashboard`, add them explicitly):

```json
"@medusajs/icons": "2.15.2",
"@medusajs/js-sdk": "2.15.2",
```

Add to `"devDependencies"`:

```json
"@testing-library/jest-dom": "^6.9.1",
"@testing-library/react": "^16.3.2",
"@testing-library/user-event": "^14.6.1",
"jsdom": "^29.1.1",
"vitest": "^4.1.9",
```

Add to `"scripts"`:

```json
"test:admin": "vitest run --config src/admin/vitest.config.ts",
```

- [ ] **Step 2: Install dependencies**

Run: `cd packages/medusa-backend/apps/backend && npm install`
Expected: installs without errors, `node_modules/vitest`, `node_modules/@testing-library/react`, `node_modules/@medusajs/icons`, `node_modules/@medusajs/js-sdk` all present.

- [ ] **Step 3: Write the failing smoke test**

Create `packages/medusa-backend/apps/backend/src/admin/lib/__tests__/smoke.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

function Hello() {
  return <p>admin test harness works</p>
}

describe("admin test harness", () => {
  it("renders a React component under jsdom", () => {
    render(<Hello />)
    expect(screen.getByText("admin test harness works")).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test to verify it fails (no config yet)**

Run: `cd packages/medusa-backend/apps/backend && npx vitest run --config src/admin/vitest.config.ts`
Expected: FAIL — `Cannot find src/admin/vitest.config.ts` or similar (the config file doesn't exist yet).

- [ ] **Step 5: Write the Vitest config and setup file**

Create `packages/medusa-backend/apps/backend/src/admin/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    root: __dirname,
    include: ["**/__tests__/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
```

Create `packages/medusa-backend/apps/backend/src/admin/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 1/1 test green (`admin test harness works`).

- [ ] **Step 7: Commit**

```bash
git add packages/medusa-backend/apps/backend/package.json packages/medusa-backend/apps/backend/package-lock.json packages/medusa-backend/apps/backend/src/admin/vitest.config.ts packages/medusa-backend/apps/backend/src/admin/vitest.setup.ts packages/medusa-backend/apps/backend/src/admin/lib/__tests__/smoke.test.tsx
git commit -m "test(admin): add Vitest test infrastructure for admin extensions"
```

---

### Task 4: Shared SDK client and seller data hooks

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/lib/sdk.ts`
- Create: `packages/medusa-backend/apps/backend/src/admin/hooks/sellers.ts`
- Test: `packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/sellers.test.tsx`

**Interfaces:**
- Consumes: `sdk.client.fetch<T>(path, init)` from `@medusajs/js-sdk`'s `Medusa` class (`init.method`, `init.body`, `init.query`).
- Produces (used by Tasks 5 and 6):
  - `type Seller = { id: string; name: string; ownerName: string; email: string; phone: string; cpfCnpj: string; bio: string | null; location: string | null; category: string | null; status: "pending" | "approved" | "active" | "suspended"; rejectionReason: string | null }`
  - `useAdminSellers(filters: { status?: string }): UseQueryResult<{ sellers: Seller[]; count: number }>`
  - `useAdminSeller(id: string): UseQueryResult<{ seller: Seller }>`
  - `useApproveSeller(): UseMutationResult<{ seller: Seller }, Error, string>` — mutate with the seller id
  - `useRejectSeller(): UseMutationResult<{ seller: Seller }, Error, { id: string; reason: string }>`
  - `useSuspendSeller(): UseMutationResult<{ seller: Seller }, Error, { id: string; reason?: string }>`
  - `useActivateSeller(): UseMutationResult<{ seller: Seller }, Error, string>` — mutate with the seller id
  - Every mutation invalidates the `["admin-sellers"]` and `["admin-seller", id]` query keys on success.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/admin/hooks/__tests__/sellers.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { sdk } from "../../lib/sdk"
import { useAdminSellers, useApproveSeller, useRejectSeller } from "../sellers"

vi.mock("../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe("useAdminSellers", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches /admin/sellers with the status filter", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })

    const { result } = renderHook(() => useAdminSellers({ status: "pending" }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers", {
      query: { status: "pending" },
    })
  })
})

describe("useApproveSeller", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("POSTs to /admin/sellers/:id/approve", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: { id: "seller_1", status: "approved" } })

    const { result } = renderHook(() => useApproveSeller(), { wrapper })
    result.current.mutate("seller_1")

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1/approve", {
      method: "POST",
    })
  })
})

describe("useRejectSeller", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("POSTs to /admin/sellers/:id/reject with the reason", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: { id: "seller_1", status: "pending" } })

    const { result } = renderHook(() => useRejectSeller(), { wrapper })
    result.current.mutate({ id: "seller_1", reason: "CNPJ inválido" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1/reject", {
      method: "POST",
      body: { reason: "CNPJ inválido" },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../../lib/sdk'` (neither file exists yet).

- [ ] **Step 3: Write the SDK client**

Create `packages/medusa-backend/apps/backend/src/admin/lib/sdk.ts`:

```ts
import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: "/",
  auth: { type: "session" },
})
```

- [ ] **Step 4: Write the seller hooks**

Create `packages/medusa-backend/apps/backend/src/admin/hooks/sellers.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

export type Seller = {
  id: string
  name: string
  ownerName: string
  email: string
  phone: string
  cpfCnpj: string
  bio: string | null
  location: string | null
  category: string | null
  status: "pending" | "approved" | "active" | "suspended"
  rejectionReason: string | null
}

type SellersResponse = { sellers: Seller[]; count: number }
type SellerResponse = { seller: Seller }

export function useAdminSellers(filters: { status?: string } = {}) {
  return useQuery({
    queryKey: ["admin-sellers", filters],
    queryFn: () =>
      sdk.client.fetch<SellersResponse>("/admin/sellers", {
        query: filters,
      }),
  })
}

export function useAdminSeller(id: string) {
  return useQuery({
    queryKey: ["admin-seller", id],
    queryFn: () => sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}`),
    enabled: !!id,
  })
}

export function useApproveSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/approve`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}

export function useRejectSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/reject`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}

export function useSuspendSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/suspend`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}

export function useActivateSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/activate`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 3/3 tests green (plus the Task 3 smoke test still passing, 4/4 total).

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/admin/lib/sdk.ts packages/medusa-backend/apps/backend/src/admin/hooks
git commit -m "feat(admin): add sdk client and TanStack Query hooks for sellers"
```

---

### Task 5: List route (`/app/sellers`)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/routes/sellers/page.tsx`
- Test: `packages/medusa-backend/apps/backend/src/admin/routes/sellers/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useAdminSellers`, `type Seller` from `../../hooks/sellers` (Task 4). `defineRouteConfig` from `@medusajs/admin-sdk`. `useNavigate` from `react-router-dom`.
- Produces: default export `SellersPage`, registered at the file-system route `sellers` (Medusa's file-based admin router maps `src/admin/routes/sellers/page.tsx` to `/app/sellers`), with sidebar label "Vendedores".

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/admin/routes/sellers/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { sdk } from "../../../lib/sdk"
import SellersPage from "../page"

vi.mock("../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SellersPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("SellersPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches sellers filtered by pending status on first render", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })

    renderPage()

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers", {
        query: { status: "pending" },
      })
    )
  })

  it("shows the pending empty state when there are no pending sellers", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })

    renderPage()

    expect(await screen.findByText("Nenhum vendedor pendente 🎉")).toBeInTheDocument()
  })

  it("renders a row per seller with name, email, and status", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      sellers: [
        {
          id: "seller_1",
          name: "Mulheres de Axé do Brasil",
          ownerName: "Maria",
          email: "contato@mercadopreto.com.br",
          phone: "71999999999",
          cpfCnpj: "12345678900",
          bio: null,
          location: null,
          category: null,
          status: "pending",
          rejectionReason: null,
        },
      ],
      count: 1,
    })

    renderPage()

    expect(await screen.findByText("Mulheres de Axé do Brasil")).toBeInTheDocument()
    expect(screen.getByText("contato@mercadopreto.com.br")).toBeInTheDocument()
    expect(screen.getByText("Pendente")).toBeInTheDocument()
  })

  it("refetches with the new status when the filter changes", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })
    const user = userEvent.setup()

    renderPage()
    await waitFor(() => expect(sdk.client.fetch).toHaveBeenCalled())

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Ativos" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers", {
        query: { status: "active" },
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../page'` (the page component doesn't exist yet).

- [ ] **Step 3: Write the list page**

Create `packages/medusa-backend/apps/backend/src/admin/routes/sellers/page.tsx`:

```tsx
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront } from "@medusajs/icons"
import { Container, Heading, Select, StatusBadge, Table, Text } from "@medusajs/ui"
import { useAdminSellers, type Seller } from "../../hooks/sellers"

const STATUS_LABELS: Record<Seller["status"], string> = {
  pending: "Pendente",
  approved: "Aprovado",
  active: "Ativo",
  suspended: "Suspenso",
}

const STATUS_COLORS: Record<Seller["status"], "orange" | "blue" | "green" | "red"> = {
  pending: "orange",
  approved: "blue",
  active: "green",
  suspended: "red",
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "pending", label: "Pendentes" },
  { value: "approved", label: "Aprovados" },
  { value: "active", label: "Ativos" },
  { value: "suspended", label: "Suspensos" },
  { value: "", label: "Todos" },
]

function SellersPage() {
  const [status, setStatus] = useState("pending")
  const navigate = useNavigate()
  const { data, isLoading } = useAdminSellers(status ? { status } : {})

  const sellers = data?.sellers ?? []

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Vendedores</Heading>
        <Select value={status} onValueChange={setStatus}>
          <Select.Trigger className="w-48">
            <Select.Value placeholder="Filtrar por status" />
          </Select.Trigger>
          <Select.Content>
            {STATUS_FILTERS.map((filter) => (
              <Select.Item key={filter.value} value={filter.value}>
                {filter.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      {!isLoading && sellers.length === 0 && (
        <div className="px-6 py-8 text-center">
          <Text>
            {status === "pending" ? "Nenhum vendedor pendente 🎉" : "Nenhum vendedor encontrado"}
          </Text>
        </div>
      )}

      {sellers.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Nome da loja</Table.HeaderCell>
              <Table.HeaderCell>E-mail</Table.HeaderCell>
              <Table.HeaderCell>Categoria</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sellers.map((seller) => (
              <Table.Row
                key={seller.id}
                className="cursor-pointer"
                onClick={() => navigate(`/sellers/${seller.id}`)}
              >
                <Table.Cell>{seller.name}</Table.Cell>
                <Table.Cell>{seller.email}</Table.Cell>
                <Table.Cell>{seller.category ?? "—"}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={STATUS_COLORS[seller.status]}>
                    {STATUS_LABELS[seller.status]}
                  </StatusBadge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Vendedores",
  icon: BuildingStorefront,
})

export default SellersPage
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 4/4 new tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/admin/routes/sellers/page.tsx packages/medusa-backend/apps/backend/src/admin/routes/sellers/__tests__/page.test.tsx
git commit -m "feat(admin): add sellers list route"
```

---

### Task 6: Detail route (`/app/sellers/:id`)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/admin/routes/sellers/[id]/page.tsx`
- Test: `packages/medusa-backend/apps/backend/src/admin/routes/sellers/[id]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useAdminSeller`, `useApproveSeller`, `useRejectSeller`, `useSuspendSeller`, `useActivateSeller`, `type Seller` from `../../../hooks/sellers` (Task 4). `useParams` from `react-router-dom`.
- Produces: default export `SellerDetailPage`, file-system route `sellers/:id` → `/app/sellers/:id`.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/admin/routes/sellers/[id]/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sdk } from "../../../../lib/sdk"
import SellerDetailPage from "../page"

vi.mock("../../../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

const pendingSeller = {
  id: "seller_1",
  name: "Mulheres de Axé do Brasil",
  ownerName: "Maria",
  email: "contato@mercadopreto.com.br",
  phone: "71999999999",
  cpfCnpj: "12345678900",
  bio: null,
  location: null,
  category: null,
  status: "pending",
  rejectionReason: null,
}

function renderDetail(initialPath = "/sellers/seller_1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/sellers/:id" element={<SellerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("SellerDetailPage", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("shows Aprovar and Rejeitar for a pending seller", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: pendingSeller })

    renderDetail()

    expect(await screen.findByRole("button", { name: "Aprovar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Suspender" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reativar" })).not.toBeInTheDocument()
  })

  it("shows only Suspender for an active seller", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: { ...pendingSeller, status: "active" } })

    renderDetail()

    expect(await screen.findByRole("button", { name: "Suspender" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reativar" })).not.toBeInTheDocument()
  })

  it("shows only Reativar for a suspended seller, and shows the reason", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      seller: { ...pendingSeller, status: "suspended", rejectionReason: "Prazo de entrega não cumprido" },
    })

    renderDetail()

    expect(await screen.findByRole("button", { name: "Reativar" })).toBeInTheDocument()
    expect(screen.getByText("Prazo de entrega não cumprido")).toBeInTheDocument()
  })

  it("does not submit the reject dialog without a reason", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: pendingSeller })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Rejeitar" }))

    const confirmButton = await screen.findByRole("button", { name: "Confirmar rejeição" })
    expect(confirmButton).toBeDisabled()

    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "CNPJ inválido")
    expect(confirmButton).toBeEnabled()
  })

  it("calls the reject mutation with the typed reason on confirm", async () => {
    vi.mocked(sdk.client.fetch)
      .mockResolvedValueOnce({ seller: pendingSeller })
      .mockResolvedValueOnce({ seller: { ...pendingSeller, rejectionReason: "CNPJ inválido" } })
    const user = userEvent.setup()

    renderDetail()
    await user.click(await screen.findByRole("button", { name: "Rejeitar" }))
    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "CNPJ inválido")
    await user.click(screen.getByRole("button", { name: "Confirmar rejeição" }))

    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1/reject", {
        method: "POST",
        body: { reason: "CNPJ inválido" },
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: FAIL — `Cannot find module '../page'`.

- [ ] **Step 3: Write the detail page**

Create `packages/medusa-backend/apps/backend/src/admin/routes/sellers/[id]/page.tsx`:

```tsx
import { useState } from "react"
import { useParams } from "react-router-dom"
import {
  Button,
  Container,
  Heading,
  Label,
  Prompt,
  StatusBadge,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  useAdminSeller,
  useApproveSeller,
  useRejectSeller,
  useSuspendSeller,
  useActivateSeller,
  type Seller,
} from "../../../hooks/sellers"

const STATUS_LABELS: Record<Seller["status"], string> = {
  pending: "Pendente",
  approved: "Aprovado",
  active: "Ativo",
  suspended: "Suspenso",
}

const STATUS_COLORS: Record<Seller["status"], "orange" | "blue" | "green" | "red"> = {
  pending: "orange",
  approved: "blue",
  active: "green",
  suspended: "red",
}

function ProfileField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text>{value || "—"}</Text>
    </div>
  )
}

function RejectDialog({ sellerId }: { sellerId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const rejectSeller = useRejectSeller()

  const handleConfirm = () => {
    rejectSeller.mutate(
      { id: sellerId, reason },
      {
        onSuccess: () => {
          toast.success("Vendedor rejeitado")
          setOpen(false)
          setReason("")
        },
        onError: () => toast.error("Não foi possível rejeitar o vendedor"),
      }
    )
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button variant="danger" size="small">
          Rejeitar
        </Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Rejeitar cadastro</Prompt.Title>
          <Prompt.Description>
            O vendedor volta para a fila de pendentes com o motivo abaixo.
          </Prompt.Description>
        </Prompt.Header>
        <div className="px-6 pb-4">
          <Label htmlFor="reject-reason">Motivo</Label>
          <Textarea
            id="reject-reason"
            aria-label="Motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Prompt.Footer>
          <Prompt.Cancel>Cancelar</Prompt.Cancel>
          <Button
            variant="danger"
            disabled={reason.trim().length === 0}
            onClick={handleConfirm}
          >
            Confirmar rejeição
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function SuspendDialog({ sellerId }: { sellerId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const suspendSeller = useSuspendSeller()

  const handleConfirm = () => {
    suspendSeller.mutate(
      { id: sellerId, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Vendedor suspenso")
          setOpen(false)
          setReason("")
        },
        onError: () => toast.error("Não foi possível suspender o vendedor"),
      }
    )
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button variant="danger" size="small">
          Suspender
        </Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Suspender vendedor</Prompt.Title>
          <Prompt.Description>
            A loja deixa de aparecer para os clientes até ser reativada.
          </Prompt.Description>
        </Prompt.Header>
        <div className="px-6 pb-4">
          <Label htmlFor="suspend-reason">Motivo (opcional)</Label>
          <Textarea
            id="suspend-reason"
            aria-label="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Prompt.Footer>
          <Prompt.Cancel>Cancelar</Prompt.Cancel>
          <Button variant="danger" onClick={handleConfirm}>
            Confirmar suspensão
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function SellerDetailPage() {
  const { id } = useParams()
  const { data } = useAdminSeller(id ?? "")
  const approveSeller = useApproveSeller()
  const activateSeller = useActivateSeller()

  const seller = data?.seller

  if (!seller) {
    return null
  }

  const handleApprove = () => {
    approveSeller.mutate(seller.id, {
      onSuccess: () => toast.success("Vendedor aprovado"),
      onError: () => toast.error("Não foi possível aprovar o vendedor"),
    })
  }

  const handleActivate = () => {
    activateSeller.mutate(seller.id, {
      onSuccess: () => toast.success("Vendedor reativado"),
      onError: () => toast.error("Não foi possível reativar o vendedor"),
    })
  }

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">{seller.name}</Heading>
          <StatusBadge color={STATUS_COLORS[seller.status]}>
            {STATUS_LABELS[seller.status]}
          </StatusBadge>
        </div>
        <div className="flex gap-2">
          {seller.status === "pending" && (
            <>
              <Button size="small" onClick={handleApprove}>
                Aprovar
              </Button>
              <RejectDialog sellerId={seller.id} />
            </>
          )}
          {seller.status === "approved" && <SuspendDialog sellerId={seller.id} />}
          {seller.status === "active" && <SuspendDialog sellerId={seller.id} />}
          {seller.status === "suspended" && (
            <Button size="small" onClick={handleActivate}>
              Reativar
            </Button>
          )}
        </div>
      </div>

      {seller.status === "approved" && (
        <div className="px-6 pb-4">
          <Text className="text-ui-fg-subtle">Aguardando o vendedor definir senha.</Text>
        </div>
      )}

      {seller.rejectionReason && (
        <div className="px-6 pb-4">
          <ProfileField
            label={seller.status === "suspended" ? "Motivo da suspensão" : "Motivo da rejeição"}
            value={seller.rejectionReason}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 px-6 pb-6">
        <ProfileField label="Nome do responsável" value={seller.ownerName} />
        <ProfileField label="E-mail" value={seller.email} />
        <ProfileField label="Telefone" value={seller.phone} />
        <ProfileField label="CPF/CNPJ" value={seller.cpfCnpj} />
        <ProfileField label="Categoria" value={seller.category} />
        <ProfileField label="Localização" value={seller.location} />
        <ProfileField label="Bio" value={seller.bio} />
      </div>
    </Container>
  )
}

export default SellerDetailPage
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — 5/5 new tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/admin/routes/sellers/\[id\]
git commit -m "feat(admin): add seller detail route with approve/reject/suspend/activate actions"
```

---

### Task 7: Final verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full backend Jest suite**

Run: `cd packages/medusa-backend/apps/backend && npm run test:unit`
Expected: PASS — all existing tests plus the 5 new ones from Tasks 1–2 (187 total, up from 185).

- [ ] **Step 2: Run the full admin Vitest suite**

Run: `cd packages/medusa-backend/apps/backend && npm run test:admin`
Expected: PASS — all 13 admin tests green (1 smoke + 3 hooks + 4 list page + 5 detail page).

- [ ] **Step 3: Typecheck the backend**

Run: `cd packages/medusa-backend/apps/backend && npx tsc --noEmit`
Expected: no errors. (If `src/admin` isn't covered by the backend's root `tsconfig.json`, this is expected to pass since `src/admin/tsconfig.json` is a separate project — confirm no errors are reported for any file touched in this plan.)

- [ ] **Step 4: Build the admin extension**

Run: `cd packages/medusa-backend/apps/backend && npx medusa build`
Expected: build succeeds with no errors, confirming the admin routes compile correctly with the real Vite-based Medusa admin build (not just Vitest's transform).

- [ ] **Step 5: Manual smoke test in the browser**

Start the dev server (`npx medusa develop` from `packages/medusa-backend/apps/backend`, or deploy per `docs/DEPLOY_PROD.md` if testing against the live server), then in a browser:
1. Log in to `/app` as admin.
2. Confirm "Vendedores" appears in the sidebar.
3. Open it — confirm it loads filtered to "Pendentes".
4. Click a seller row — confirm the detail page loads with the right actions for its status.
5. If a pending seller exists, click "Rejeitar", confirm the dialog requires a reason, submit it, confirm the seller reappears in the "Pendentes" list with the reason shown.
6. If a suspended seller exists (or suspend one from "active" first), click "Reativar", confirm it moves to "Ativos".

Expected: all steps work with no console errors, matching the behavior verified in the automated tests.

- [ ] **Step 6: Commit if any fix was needed**

If steps 1–5 required no code changes, there is nothing to commit — this task is verification-only. If a fix was needed, commit it with an appropriate `fix(admin): ...` message before proceeding.
