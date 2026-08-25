# Seller Session via HttpOnly Cookie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the seller's session from a `localStorage`-persisted JWT (read/writable by any XSS on the storefront origin) to a `HttpOnly` cookie, closing the account-takeover risk flagged by the 29/jul pentest.

**Architecture:** The JWT itself (`createSellerToken`/`verifySellerToken` in `utils/seller-jwt.ts`) is untouched — only its transport changes, from an `Authorization: Bearer` header built from a client-readable token to a `Set-Cookie`/`Cookie` pair the browser handles automatically and JavaScript can never read. Backend gets a small hand-rolled cookie-parsing/building utility (no new dependency, matching the codebase's existing hand-rolled-crypto style) and a new logout endpoint. Frontend drops `token` from its API surface and its Zustand store entirely, and the seller-portal route guard becomes a real server round-trip (`GET /seller/me`) instead of a synchronous `localStorage` read.

**Tech Stack:** Medusa v2 (Express-based routes/middlewares), Jest (`pnpm test:unit` in `packages/medusa-backend/apps/backend`), Next.js 15 App Router, Zustand, Vitest (`pnpm test` in `apps/storefront`).

**Spec:** `docs/superpowers/specs/2026-08-25-seller-session-cookie-design.md`

## Deviation from the spec (found while planning — flagging, not re-asking)

The spec says the cookie's `Path` should be `/api`. Checking `apps/storefront/.env.example`/`.env.template` shows local dev calls the backend directly at `http://localhost:9000` — **no `/api` prefix** (that prefix only exists in production, where nginx proxies `/api` → the Medusa container on `teste.mercadopreto.com.br`). A cookie scoped to `Path=/api` would never be sent back on local-dev requests to `/seller/me`, `/store/sellers/login`, etc. — the login would appear to succeed but every subsequent authenticated call would 401. This plan uses **`Path=/`** instead, which works identically in both environments; the cookie stays `HttpOnly` regardless, so the only cost is the (already-`HttpOnly`, still-invisible-to-JS) cookie also being attached to full-page navigations under `/painel/*`, which carries no new exposure.

## Global Constraints

- Cookie name: `seller_session`. Attributes: `HttpOnly`; `SameSite=Strict`; `Path=/`; `Max-Age=604800` (7 days, matches the JWT's existing `exp`); `Secure` only when `process.env.NODE_ENV === "production"`.
- No new dependencies (no `cookie-parser`, no `jsonwebtoken`) — hand-rolled parsing/building, matching `utils/seller-jwt.ts`'s existing style.
- No CSRF token scheme — `SameSite=Strict` is the deliberate, sufficient mitigation (see spec's Non-Goals).
- No migration path for pre-existing `localStorage` sessions — sellers re-login once after deploy (test phase, acceptable).
- Backend unit tests: Jest, `*.unit.spec.ts` under `src/**/__tests__/`, run via `pnpm test:unit` from `packages/medusa-backend/apps/backend`.
- Frontend unit tests: Vitest, `*.test.ts`/`*.test.tsx`, run via `pnpm test` from `apps/storefront`.
- Never mock what can be tested with the real implementation (e.g. use the real `SellerModuleService.hashPassword`/`verifyPassword`, the real `createSellerToken`, the real `useSellerStore`).

---

### Task 1: Backend cookie utilities

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/cookies.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/cookies.unit.spec.ts`

**Interfaces:**
- Produces: `parseCookie(cookieHeader: string | undefined, name: string): string | null`, `buildSetCookie(name: string, value: string, maxAgeSeconds: number, options?: { secure?: boolean }): string`, `buildClearCookie(name: string, options?: { secure?: boolean }): string`, `SELLER_SESSION_COOKIE: string`, `SELLER_SESSION_MAX_AGE: number` — consumed by Tasks 2, 3, and 4.

- [ ] **Step 1: Write the failing tests**

Create `packages/medusa-backend/apps/backend/src/utils/__tests__/cookies.unit.spec.ts`:

```ts
import { parseCookie, buildSetCookie, buildClearCookie } from "../cookies"

describe("parseCookie", () => {
  it("extracts the named cookie's value", () => {
    expect(parseCookie("seller_session=abc.def.ghi", "seller_session")).toBe("abc.def.ghi")
  })

  it("finds the named cookie among several", () => {
    expect(parseCookie("other=1; seller_session=abc; another=2", "seller_session")).toBe("abc")
  })

  it("returns null when the cookie is absent", () => {
    expect(parseCookie("other=1", "seller_session")).toBeNull()
  })

  it("returns null when the header is undefined", () => {
    expect(parseCookie(undefined, "seller_session")).toBeNull()
  })

  it("decodes a URI-encoded value", () => {
    expect(parseCookie("seller_session=a%3Bb", "seller_session")).toBe("a;b")
  })
})

describe("buildSetCookie", () => {
  it("includes HttpOnly, SameSite=Strict, Path=/ and Max-Age", () => {
    const header = buildSetCookie("seller_session", "abc.def.ghi", 604800)
    expect(header).toBe("seller_session=abc.def.ghi; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800")
  })

  it("appends Secure when options.secure is true", () => {
    const header = buildSetCookie("seller_session", "abc", 604800, { secure: true })
    expect(header).toContain("; Secure")
  })

  it("omits Secure when options.secure is false or absent", () => {
    const header = buildSetCookie("seller_session", "abc", 604800)
    expect(header).not.toContain("Secure")
  })

  it("URI-encodes the value", () => {
    const header = buildSetCookie("seller_session", "a;b", 604800)
    expect(header).toContain("seller_session=a%3Bb")
  })
})

describe("buildClearCookie", () => {
  it("sets Max-Age=0 to expire the cookie immediately", () => {
    expect(buildClearCookie("seller_session")).toContain("Max-Age=0")
  })

  it("carries the secure option through", () => {
    expect(buildClearCookie("seller_session", { secure: true })).toContain("Secure")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/utils/__tests__/cookies.unit.spec.ts`
Expected: FAIL with "Cannot find module '../cookies'"

- [ ] **Step 3: Write the implementation**

Create `packages/medusa-backend/apps/backend/src/utils/cookies.ts`:

```ts
export const SELLER_SESSION_COOKIE = "seller_session"
export const SELLER_SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days, matches the JWT's exp

export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

export function buildSetCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  options?: { secure?: boolean }
): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (options?.secure) attrs.push("Secure")
  return attrs.join("; ")
}

export function buildClearCookie(name: string, options?: { secure?: boolean }): string {
  return buildSetCookie(name, "", 0, options)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/utils/__tests__/cookies.unit.spec.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/cookies.ts packages/medusa-backend/apps/backend/src/utils/__tests__/cookies.unit.spec.ts
git commit -m "feat(fiscal): adiciona utilitários de cookie para sessão do vendedor"
```

---

### Task 2: Login route sets the session cookie instead of returning the token

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/sellers/login/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/sellers/login/__tests__/route.unit.spec.ts` (new)

**Interfaces:**
- Consumes: `buildSetCookie`, `SELLER_SESSION_COOKIE`, `SELLER_SESSION_MAX_AGE` from Task 1 (`../../../../../utils/cookies` relative to the test file, `../../../../utils/cookies` relative to the route file).
- Produces: `POST /store/sellers/login` response body is now `{ seller: {...} }` only (no `token` field) — Task 8 depends on this.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/store/sellers/login/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"
import { SELLER_MODULE } from "../../../../../modules/seller"
import SellerModuleService from "../../../../../modules/seller/service"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown, _headers: {} as Record<string, string> } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.setHeader = (name: string, value: string) => { res._headers[name] = value; return res }
  return res
}

describe("POST /store/sellers/login", () => {
  it("sets the session as an HttpOnly cookie and never returns the token in the body", async () => {
    const passwordHash = SellerModuleService.hashPassword("secret123")
    const seller = { id: "seller_1", email: "loja@teste.com", name: "Loja Teste", status: "approved", passwordHash }
    const listSellers = jest.fn().mockResolvedValue([seller])
    const req = {
      body: { email: "loja@teste.com", password: "secret123" },
      scope: makeScope({ [SELLER_MODULE]: { listSellers } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._body).toEqual({
      seller: { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" },
    })
    expect(res._headers["Set-Cookie"]).toContain("seller_session=")
    expect(res._headers["Set-Cookie"]).toContain("HttpOnly")
    expect(res._headers["Set-Cookie"]).toContain("SameSite=Strict")
  })

  it("returns 401 without setting a cookie when the password is wrong", async () => {
    const passwordHash = SellerModuleService.hashPassword("secret123")
    const seller = { id: "seller_1", email: "loja@teste.com", name: "Loja Teste", status: "approved", passwordHash }
    const listSellers = jest.fn().mockResolvedValue([seller])
    const req = {
      body: { email: "loja@teste.com", password: "wrong-password" },
      scope: makeScope({ [SELLER_MODULE]: { listSellers } }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(401)
    expect(res._headers["Set-Cookie"]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/api/store/sellers/login/__tests__/route.unit.spec.ts`
Expected: FAIL — `res._body` still contains a `token` field (current implementation returns `{ token, seller }`)

- [ ] **Step 3: Update the route**

In `packages/medusa-backend/apps/backend/src/api/store/sellers/login/route.ts`, add the import and replace the final block:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"
import { createSellerToken } from "../../../../utils/seller-jwt"
import { buildSetCookie, SELLER_SESSION_COOKIE, SELLER_SESSION_MAX_AGE } from "../../../../utils/cookies"
```

Replace:

```ts
  const token = createSellerToken(seller.id, seller.email)
  res.json({
    token,
    seller: { id: seller.id, name: seller.name, email: seller.email, status: seller.status },
  })
}
```

With:

```ts
  const token = createSellerToken(seller.id, seller.email)
  res.setHeader(
    "Set-Cookie",
    buildSetCookie(SELLER_SESSION_COOKIE, token, SELLER_SESSION_MAX_AGE, {
      secure: process.env.NODE_ENV === "production",
    })
  )
  res.json({
    seller: { id: seller.id, name: seller.name, email: seller.email, status: seller.status },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/api/store/sellers/login/__tests__/route.unit.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/sellers/login/route.ts packages/medusa-backend/apps/backend/src/api/store/sellers/login/__tests__/route.unit.spec.ts
git commit -m "fix(fiscal): sessão do vendedor passa a ir em cookie HttpOnly no login"
```

---

### Task 3: Logout route clears the session cookie

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/store/sellers/logout/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/sellers/logout/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `buildClearCookie`, `SELLER_SESSION_COOKIE` from Task 1.
- Produces: `POST /store/sellers/logout` — consumed by the frontend's `sellerLogout()` in Task 5.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/store/sellers/logout/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown, _headers: {} as Record<string, string> } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.setHeader = (name: string, value: string) => { res._headers[name] = value; return res }
  return res
}

describe("POST /store/sellers/logout", () => {
  it("clears the session cookie", async () => {
    const req = {} as any
    const res = makeRes()

    await POST(req, res)

    expect(res._headers["Set-Cookie"]).toContain("seller_session=")
    expect(res._headers["Set-Cookie"]).toContain("Max-Age=0")
    expect(res._body).toEqual({ message: "Logout realizado" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/api/store/sellers/logout/__tests__/route.unit.spec.ts`
Expected: FAIL with "Cannot find module '../route'"

- [ ] **Step 3: Write the implementation**

Create `packages/medusa-backend/apps/backend/src/api/store/sellers/logout/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildClearCookie, SELLER_SESSION_COOKIE } from "../../../../utils/cookies"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader(
    "Set-Cookie",
    buildClearCookie(SELLER_SESSION_COOKIE, { secure: process.env.NODE_ENV === "production" })
  )
  res.json({ message: "Logout realizado" })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/api/store/sellers/logout/__tests__/route.unit.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/sellers/logout/route.ts packages/medusa-backend/apps/backend/src/api/store/sellers/logout/__tests__/route.unit.spec.ts
git commit -m "feat(fiscal): adiciona rota de logout do vendedor para limpar o cookie de sessão"
```

---

### Task 4: `sellerAuth` middleware reads the session cookie instead of the Authorization header

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/middlewares.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/__tests__/middlewares.unit.spec.ts` (new)

**Interfaces:**
- Consumes: `parseCookie`, `SELLER_SESSION_COOKIE` from Task 1; `createSellerToken` from existing `utils/seller-jwt.ts` (test only, to fabricate a valid session cookie value).
- Produces: `sellerAuth` and `sellerCors` become named exports (previously only the default `defineMiddlewares(...)` was exported) — nothing outside this file consumes them, this is purely to make them directly unit-testable.

- [ ] **Step 1: Write the failing tests**

Create `packages/medusa-backend/apps/backend/src/api/__tests__/middlewares.unit.spec.ts`:

```ts
import { sellerAuth } from "../middlewares"
import { createSellerToken } from "../../utils/seller-jwt"

function makeReq(cookieHeader?: string) {
  return { headers: { cookie: cookieHeader } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("sellerAuth", () => {
  it("populates req.sellerId/req.sellerEmail from a valid session cookie and calls next()", () => {
    const token = createSellerToken("seller_1", "loja@teste.com")
    const req = makeReq(`seller_session=${encodeURIComponent(token)}`)
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(req.sellerId).toBe("seller_1")
    expect(req.sellerEmail).toBe("loja@teste.com")
    expect(next).toHaveBeenCalled()
  })

  it("rejects when the cookie header has no seller_session cookie", () => {
    const req = makeReq(undefined)
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body).toEqual({ error: "Token do vendedor obrigatório" })
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects a malformed cookie value", () => {
    const req = makeReq("seller_session=not-a-real-token")
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body).toEqual({ error: "Token inválido ou expirado" })
    expect(next).not.toHaveBeenCalled()
  })

  it("ignores unrelated cookies and still requires seller_session", () => {
    const req = makeReq("other_cookie=abc; another=def")
    const res = makeRes()
    const next = jest.fn()

    sellerAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/api/__tests__/middlewares.unit.spec.ts`
Expected: FAIL — `sellerAuth` is not exported from `../middlewares` yet

- [ ] **Step 3: Update the middleware**

In `packages/medusa-backend/apps/backend/src/api/middlewares.ts`, add the import:

```ts
import crypto from "crypto"
import { defineMiddlewares } from "@medusajs/framework/http"
import rateLimit from "express-rate-limit"
import { parseCookie, SELLER_SESSION_COOKIE } from "../utils/cookies"
```

Replace the `sellerCors` and `sellerAuth` functions (add `export` and swap the header read for the cookie read):

```ts
export function sellerCors(req: any, res: any, next: any) {
  const origin = req.headers.origin as string | undefined
  const allowed = (process.env.STORE_CORS || "").split(",").map((s: string) => s.trim())
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization")
  }
  if (req.method === "OPTIONS") return res.status(200).end()
  next()
}

export function sellerAuth(req: any, res: any, next: any) {
  const token = parseCookie(req.headers.cookie, SELLER_SESSION_COOKIE)
  if (!token) {
    return res.status(401).json({ error: "Token do vendedor obrigatório" })
  }
  try {
    const payload = verifySellerToken(token)
    req.sellerId = payload.sellerId
    req.sellerEmail = payload.email
    next()
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" })
  }
}
```

Add the logout route to the `sellerCors` matcher list in the `defineMiddlewares` call at the bottom of the file:

```ts
export default defineMiddlewares({
  routes: [
    {
      matcher: "/seller",
      middlewares: [sellerCors, sellerAuth],
    },
    {
      matcher: "/store/sellers/login",
      middlewares: [loginRateLimit],
    },
    {
      matcher: "/store/sellers/register",
      middlewares: [registerRateLimit],
    },
    {
      matcher: "/store/sellers/set-password",
      middlewares: [loginRateLimit],
    },
    {
      matcher: "/store/sellers/logout",
      middlewares: [sellerCors],
    },
  ],
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit npx jest src/api/__tests__/middlewares.unit.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full backend unit suite**

Run: `cd packages/medusa-backend/apps/backend && pnpm test:unit`
Expected: all existing tests still PASS (no other test touches `Authorization` headers for `/seller/*` routes — confirm by checking output for the `seller/products` and `seller/products/[id]` test files, which mock `req.sellerId` directly and are unaffected by this change).

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/middlewares.ts packages/medusa-backend/apps/backend/src/api/__tests__/middlewares.unit.spec.ts
git commit -m "fix(fiscal): sellerAuth passa a ler o cookie de sessão em vez do header Authorization"
```

---

### Task 5: Frontend `seller-api.ts` drops the `token` parameter and uses cookie credentials

**Files:**
- Modify: `apps/storefront/src/lib/seller-api.ts`
- Modify: `apps/storefront/src/lib/__tests__/seller-api.test.ts`

**Interfaces:**
- Produces: every exported function in `seller-api.ts` loses its `token: string` first/second parameter; `sellerLogin` now resolves to `{ seller: {...} }` (no `token`); new `sellerLogout(): Promise<void>`. Consumed by Tasks 7, 8, 9.

- [ ] **Step 1: Write the failing tests**

Replace `apps/storefront/src/lib/__tests__/seller-api.test.ts` in full:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { getSellerProduct, sellerLogin, sellerLogout, setSellerPassword } from "../seller-api"

describe("getSellerProduct", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches a single product by id from the detail endpoint, with the session cookie included", async () => {
    const product = { id: "prod_1", title: "Produto", categories: [{ id: "pcat_1", name: "Categoria" }] }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ product }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await getSellerProduct("prod_1")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/seller/products/prod_1"),
      expect.objectContaining({ credentials: "include" })
    )
    expect(result.product).toEqual(product)
  })

  it("throws when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Produto não encontrado nesta loja" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getSellerProduct("missing")).rejects.toThrow("Produto não encontrado nesta loja")
  })
})

describe("sellerLogin", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the publishable API key header and includes credentials so the session cookie is stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ seller: { id: "seller_1" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await sellerLogin("joao@teste.com", "secret")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/login"),
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "x-publishable-api-key": expect.any(String) }),
      })
    )
    expect(result).toEqual({ seller: { id: "seller_1" } })
  })
})

describe("sellerLogout", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts to the logout endpoint with credentials so the server can clear the cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)

    await sellerLogout()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" })
    )
  })
})

describe("setSellerPassword", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the publishable API key header the backend's /store middleware requires", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Senha configurada" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await setSellerPassword("joao@teste.com", "novaSenha123")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/sellers/set-password"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-publishable-api-key": expect.any(String) }),
      })
    )
  })

  it("throws with the backend error message when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Token inválido" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(setSellerPassword("joao@teste.com", "novaSenha123")).rejects.toThrow("Token inválido")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/seller-api.test.ts`
Expected: FAIL — `getSellerProduct`/`sellerLogin` still require a `token` argument and don't send `credentials: "include"`; `sellerLogout` doesn't exist yet.

- [ ] **Step 3: Rewrite the implementation**

Replace `apps/storefront/src/lib/seller-api.ts` in full:

```ts
const BASE_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

async function sellerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `API ${res.status}: ${path}`)
  }
  return res.json()
}

// /store/sellers/* routes sit under Medusa's global /store middleware, which
// requires this header even for the pre-auth login/set-password calls below.
export async function sellerLogin(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/store/sellers/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'Erro ao fazer login')
  return body as { seller: { id: string; name: string; email: string; status: string } }
}

export async function sellerLogout() {
  await fetch(`${BASE_URL}/store/sellers/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-publishable-api-key': PUB_KEY },
  })
}

export async function setSellerPassword(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/store/sellers/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'Erro ao configurar senha')
  return body as { message: string }
}

export async function getMe() {
  return sellerFetch<{ seller: Record<string, unknown> }>('/seller/me')
}

export async function patchMe(data: Record<string, unknown>) {
  return sellerFetch<{ seller: Record<string, unknown> }>('/seller/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getDashboard() {
  return sellerFetch<{
    stats: {
      totalOrders: number
      pendingOrders: number
      productCount: number
      totalRevenue: number
      pendingPayout: number
    }
  }>('/seller/dashboard')
}

export async function getSellerProducts(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{ products: unknown[]; count: number }>(`/seller/products?${qs}`)
}

export async function getSellerProduct(id: string) {
  return sellerFetch<{ product: Record<string, unknown> }>(`/seller/products/${id}`)
}

export async function createSellerProduct(data: Record<string, unknown>) {
  return sellerFetch<{ product: Record<string, unknown> }>('/seller/products', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateSellerProduct(id: string, data: Record<string, unknown>) {
  return sellerFetch<{ product: Record<string, unknown> }>(`/seller/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteSellerProduct(id: string) {
  return sellerFetch<void>(`/seller/products/${id}`, { method: 'DELETE' })
}

export async function getSellerOrders(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{ orders: unknown[]; count: number }>(`/seller/orders?${qs}`)
}

export async function getSellerCommissions(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams({
    limit: String(params?.limit ?? 20),
    offset: String(params?.offset ?? 0),
  })
  return sellerFetch<{
    commissions: unknown[]
    totals: { grossAmount: number; commissionAmount: number; sellerPayout: number }
    count: number
  }>(`/seller/commissions?${qs}`)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/seller-api.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/lib/seller-api.ts apps/storefront/src/lib/__tests__/seller-api.test.ts
git commit -m "fix(fiscal): seller-api usa cookie de sessão em vez de token manual no header"
```

---

### Task 6: Frontend `seller-store.ts` drops `token` and `localStorage` persistence

**Files:**
- Modify: `apps/storefront/src/lib/seller-store.ts`
- Test: `apps/storefront/src/lib/__tests__/seller-store.test.ts` (new)

**Interfaces:**
- Produces: `useSellerStore` now exposes `{ seller: SellerProfile | null, setSeller(seller), updateSeller(partial), clearSeller() }` — no `token`, no `login`, no `logout`, no `isAuthenticated`. Consumed by Tasks 7, 8, 9.

- [ ] **Step 1: Write the failing tests**

Create `apps/storefront/src/lib/__tests__/seller-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest"
import { useSellerStore } from "../seller-store"

describe("useSellerStore", () => {
  afterEach(() => {
    useSellerStore.setState({ seller: null })
  })

  it("starts with no seller", () => {
    expect(useSellerStore.getState().seller).toBeNull()
  })

  it("setSeller populates the seller profile", () => {
    const seller = { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" }
    useSellerStore.getState().setSeller(seller)
    expect(useSellerStore.getState().seller).toEqual(seller)
  })

  it("updateSeller merges partial changes into the existing profile", () => {
    useSellerStore.getState().setSeller({ id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" })
    useSellerStore.getState().updateSeller({ bio: "Nova bio" })
    expect(useSellerStore.getState().seller).toEqual(
      expect.objectContaining({ id: "seller_1", bio: "Nova bio" })
    )
  })

  it("clearSeller resets the profile to null", () => {
    useSellerStore.getState().setSeller({ id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" })
    useSellerStore.getState().clearSeller()
    expect(useSellerStore.getState().seller).toBeNull()
  })

  it("does not expose a token field", () => {
    expect(useSellerStore.getState()).not.toHaveProperty("token")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/seller-store.test.ts`
Expected: FAIL — current store has no `setSeller`/`clearSeller`, and does have a `token` field

- [ ] **Step 3: Rewrite the implementation**

Replace `apps/storefront/src/lib/seller-store.ts` in full:

```ts
'use client'

import { create } from 'zustand'

export type SellerProfile = {
  id: string
  name: string
  email: string
  status: string
  ownerName?: string
  bio?: string
  location?: string
  category?: string
}

export type SellerBanking = {
  pixKey?: string
  pixKeyType?: string
  bankName?: string
  bankAgency?: string
  bankAccount?: string
  bankAccountType?: string
}

type SellerStore = {
  seller: SellerProfile | null
  setSeller: (seller: SellerProfile) => void
  updateSeller: (seller: Partial<SellerProfile>) => void
  clearSeller: () => void
}

export const useSellerStore = create<SellerStore>()((set) => ({
  seller: null,
  setSeller: (seller) => set({ seller }),
  updateSeller: (updates) =>
    set((state) => ({ seller: state.seller ? { ...state.seller, ...updates } : null })),
  clearSeller: () => set({ seller: null }),
}))
```

The session itself now lives only in the `HttpOnly` cookie (invisible to JS); the store just mirrors the profile Task 7's `/seller/me` check returns, in memory, for the current page session. No `persist` middleware — nothing here needs to survive a hard reload, since `painel/layout.tsx` re-verifies via the server on every mount anyway.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/seller-store.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/lib/seller-store.ts apps/storefront/src/lib/__tests__/seller-store.test.ts
git commit -m "fix(fiscal): remove token de localStorage do estado do vendedor"
```

---

### Task 7: `painel/layout.tsx` guards routes via a real `/seller/me` check

**Files:**
- Modify: `apps/storefront/src/app/painel/layout.tsx`
- Test: `apps/storefront/src/app/painel/__tests__/layout.test.tsx` (new)

**Interfaces:**
- Consumes: `getMe`, `sellerLogout` from Task 5; `useSellerStore`, `SellerProfile` from Task 6.

- [ ] **Step 1: Write the failing tests**

Create `apps/storefront/src/app/painel/__tests__/layout.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PainelLayout from "../layout"
import * as sellerApi from "@/lib/seller-api"
import { useSellerStore } from "@/lib/seller-store"

const replace = vi.fn()
const push = vi.fn()
let pathname = "/painel/dashboard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => pathname,
}))

describe("PainelLayout", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    replace.mockClear()
    push.mockClear()
    useSellerStore.setState({ seller: null })
    pathname = "/painel/dashboard"
  })

  it("renders children once /seller/me confirms an authenticated session", async () => {
    vi.spyOn(sellerApi, "getMe").mockResolvedValue({
      seller: { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" },
    })

    render(<PainelLayout><p>Conteúdo protegido</p></PainelLayout>)

    expect(await screen.findByText("Conteúdo protegido")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it("redirects to login when /seller/me rejects", async () => {
    vi.spyOn(sellerApi, "getMe").mockRejectedValue(new Error("Token inválido ou expirado"))

    render(<PainelLayout><p>Conteúdo protegido</p></PainelLayout>)

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/painel/login"))
    expect(screen.queryByText("Conteúdo protegido")).not.toBeInTheDocument()
  })

  it("renders the login page without checking the session", () => {
    pathname = "/painel/login"
    const getMe = vi.spyOn(sellerApi, "getMe")

    render(<PainelLayout><p>Formulário de login</p></PainelLayout>)

    expect(screen.getByText("Formulário de login")).toBeInTheDocument()
    expect(getMe).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && npx vitest run src/app/painel/__tests__/layout.test.tsx`
Expected: FAIL — current layout reads `isAuthenticated()`/`localStorage`, never calls `getMe()`

- [ ] **Step 3: Rewrite the implementation**

Replace `apps/storefront/src/app/painel/layout.tsx` in full:

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSellerStore, type SellerProfile } from '@/lib/seller-store'
import { getMe, sellerLogout } from '@/lib/seller-api'
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  DollarSign,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-react'

const navItems = [
  { href: '/painel/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/painel/produtos', label: 'Meus produtos', icon: Package },
  { href: '/painel/pedidos', label: 'Pedidos', icon: ShoppingBag },
  { href: '/painel/comissoes', label: 'Comissões', icon: DollarSign },
  { href: '/painel/perfil', label: 'Meu perfil', icon: User },
]

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  const { seller, setSeller, clearSeller } = useSellerStore()
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (pathname === '/painel/login') {
      setChecking(false)
      return
    }
    getMe()
      .then((data) => setSeller(data.seller as SellerProfile))
      .catch(() => {
        clearSeller()
        router.replace('/painel/login')
      })
      .finally(() => setChecking(false))
    // Runs once per layout mount — navigating between /painel/* pages does not
    // remount this layout, so re-running per pathname change would needlessly
    // re-check the session on every click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (pathname === '/painel/login') return <>{children}</>

  if (checking || !seller) return null

  async function handleLogout() {
    await sellerLogout()
    clearSeller()
    router.push('/painel/login')
  }

  return (
    <div className="flex min-h-screen bg-sand">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-onyx/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-onyx text-cream flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-cream/10">
          <Link href="/" className="font-display font-black text-lg">
            <span className="text-amber">Mercado</span>
            <span className="text-cream"> Preto</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-cream/60 hover:text-cream"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Seller info */}
        <div className="px-6 py-4 border-b border-cream/10">
          <div className="w-10 h-10 rounded-full bg-amber/20 flex items-center justify-center font-display font-black text-amber mb-2">
            {seller?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <p className="text-sm font-semibold text-cream leading-tight truncate">{seller?.name}</p>
          <p className="text-xs text-cream/40 truncate">{seller?.email}</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-amber text-onyx'
                    : 'text-cream/70 hover:bg-cream/10 hover:text-cream'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-cream/10">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-cream/60 hover:bg-cream/10 hover:text-cream transition-colors w-full"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white border-b border-sand-dark px-4 sm:px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-onyx/60 hover:text-onyx"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="text-sm text-onyx/50">Portal do Vendedor</p>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/storefront && npx vitest run src/app/painel/__tests__/layout.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/app/painel/layout.tsx apps/storefront/src/app/painel/__tests__/layout.test.tsx
git commit -m "fix(fiscal): painel do vendedor valida sessão via /seller/me em vez de localStorage"
```

---

### Task 8: `painel/login/page.tsx` no longer handles a token

**Files:**
- Modify: `apps/storefront/src/app/painel/login/page.tsx`
- Test: `apps/storefront/src/app/painel/login/__tests__/page.test.tsx` (new)

**Interfaces:**
- Consumes: `sellerLogin` from Task 5 (now resolves `{ seller }`, no `token`); `setSeller` from Task 6.

- [ ] **Step 1: Write the failing tests**

Create `apps/storefront/src/app/painel/login/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import PainelLoginPage from "../page"
import * as sellerApi from "@/lib/seller-api"
import { useSellerStore } from "@/lib/seller-store"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

describe("PainelLoginPage", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    push.mockClear()
    useSellerStore.setState({ seller: null })
  })

  it("stores the returned seller profile and navigates to the dashboard on success", async () => {
    const seller = { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" }
    vi.spyOn(sellerApi, "sellerLogin").mockResolvedValue({ seller })
    const user = userEvent.setup()

    render(<PainelLoginPage />)
    await user.type(screen.getByLabelText("E-mail"), "loja@teste.com")
    await user.type(screen.getByLabelText("Senha"), "secret123")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/painel/dashboard"))
    expect(useSellerStore.getState().seller).toEqual(seller)
  })

  it("shows the backend error message and does not navigate when login fails", async () => {
    vi.spyOn(sellerApi, "sellerLogin").mockRejectedValue(new Error("Credenciais inválidas"))
    const user = userEvent.setup()

    render(<PainelLoginPage />)
    await user.type(screen.getByLabelText("E-mail"), "loja@teste.com")
    await user.type(screen.getByLabelText("Senha"), "senhaerrada")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    expect(await screen.findByText("Credenciais inválidas")).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && npx vitest run src/app/painel/login/__tests__/page.test.tsx`
Expected: FAIL — `getByLabelText` finds nothing (inputs have no `id`/`htmlFor` yet), and the page still calls `login(token, seller)`

- [ ] **Step 3: Rewrite the implementation**

Replace `apps/storefront/src/app/painel/login/page.tsx` in full:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSellerStore } from '@/lib/seller-store'
import { sellerLogin } from '@/lib/seller-api'
import { Loader2 } from 'lucide-react'

export default function PainelLoginPage() {
  const { setSeller } = useSellerStore()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { seller } = await sellerLogin(email, password)
      setSeller(seller)
      router.push('/painel/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-onyx flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="font-display text-2xl font-black">
            <span className="text-amber">Mercado</span>
            <span className="text-cream"> Preto</span>
          </Link>
          <p className="text-cream/50 text-sm mt-2">Portal do Vendedor</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl p-6 shadow-xl space-y-4"
        >
          <h1 className="font-display font-black text-xl text-onyx mb-6">Entrar na sua loja</h1>

          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-onyx/60 mb-1">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-onyx/60 mb-1">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-sm text-terracotta bg-terracotta/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-amber py-3 font-display font-bold text-onyx hover:bg-amber-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Entrar
          </button>
        </form>

        <p className="text-center text-cream/40 text-xs mt-6">
          Ainda não é vendedor?{' '}
          <Link href="/vender" className="text-amber hover:underline">
            Cadastre-se
          </Link>
        </p>
      </div>
    </div>
  )
}
```

Note what was removed versus the original: the `hydrated` state, `useSellerStore.persist.rehydrate()`, and the "already authenticated → redirect to dashboard" effect are gone — that was a synchronous `localStorage` check that no longer has anything to read (see the spec's explicit call on this: worst case is a logged-in seller sees the login form and has to click through, not a security regression).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/storefront && npx vitest run src/app/painel/login/__tests__/page.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/app/painel/login/page.tsx apps/storefront/src/app/painel/login/__tests__/page.test.tsx
git commit -m "fix(fiscal): login do vendedor não manipula mais token, só o cookie de sessão"
```

---

### Task 9: Remaining seller-panel pages drop the `token` parameter

**Files:**
- Modify: `apps/storefront/src/app/painel/produtos/page.tsx`
- Modify: `apps/storefront/src/app/painel/produtos/[id]/page.tsx`
- Modify: `apps/storefront/src/app/painel/produtos/novo/page.tsx`
- Modify: `apps/storefront/src/app/painel/comissoes/page.tsx`
- Modify: `apps/storefront/src/app/painel/pedidos/page.tsx`
- Modify: `apps/storefront/src/app/painel/dashboard/page.tsx`
- Modify: `apps/storefront/src/app/painel/perfil/page.tsx`
- Modify: `apps/storefront/src/app/painel/produtos/novo/__tests__/page.test.tsx`
- Modify: `apps/storefront/src/app/painel/produtos/[id]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: the token-free `seller-api.ts` functions from Task 5. By the time any of these pages mount, `painel/layout.tsx` (Task 7) has already confirmed the session and populated `seller` in the store — so none of these pages need their own auth guard anymore, only `produtos/[id]/page.tsx` keeps a plain `!id` check (route param, not an auth concern) and `dashboard.tsx`/`perfil.tsx` keep reading `seller` because they display it.

This task has no new production behavior of its own (all coverage comes from Tasks 5-8) — it's a mechanical propagation of the signature change. Because every edit is the same shape (drop a token guard, drop `token` from the destructure/deps, drop the token argument from an API call), do all nine files in one pass, then run the whole frontend suite once at the end.

- [ ] **Step 1: `produtos/page.tsx` — drop the store import and token guard**

In `apps/storefront/src/app/painel/produtos/page.tsx`, remove the `useSellerStore` import (line 5) and replace:

```tsx
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
```

With:

```tsx
export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    try {
      const data = await getSellerProducts()
      setProducts(data.products as Product[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este produto?')) return
    setDeletingId(id)
    try {
      await deleteSellerProduct(id)
      setProducts((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao excluir produto')
    } finally {
      setDeletingId(null)
    }
  }
```

- [ ] **Step 2: `produtos/[id]/page.tsx` — drop the store import and token guard, keep the `id` guard**

In `apps/storefront/src/app/painel/produtos/[id]/page.tsx`, remove the `useSellerStore` import (line 6) and replace:

```tsx
export default function EditarProdutoPage() {
  const { token } = useSellerStore()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
```

With:

```tsx
export default function EditarProdutoPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
```

Replace:

```tsx
  useEffect(() => {
    if (!token || !id) return
    getSellerProduct(token, id)
      .then((data) => {
```

With:

```tsx
  useEffect(() => {
    if (!id) return
    getSellerProduct(id)
      .then((data) => {
```

Replace `}, [token, id, router])` with `}, [id, router])`.

Replace:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !id) return
    setError('')
    setSaving(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await updateSellerProduct(token, id, {
```

With:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setError('')
    setSaving(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await updateSellerProduct(id, {
```

- [ ] **Step 3: `produtos/novo/page.tsx` — drop the store import and token guard**

In `apps/storefront/src/app/painel/produtos/novo/page.tsx`, remove the `useSellerStore` import (line 6) and replace:

```tsx
export default function NovoProdutoPage() {
  const { token } = useSellerStore()
  const router = useRouter()
```

With:

```tsx
export default function NovoProdutoPage() {
  const router = useRouter()
```

Replace:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setLoading(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await createSellerProduct(token, {
```

With:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const priceAmount = Math.round(Number(form.price.replace(',', '.')) * 100)
      if (isNaN(priceAmount) || priceAmount <= 0) throw new Error('Preço inválido')

      await createSellerProduct({
```

- [ ] **Step 4: `comissoes/page.tsx` — drop the store import and token guard**

In `apps/storefront/src/app/painel/comissoes/page.tsx`, remove the `useSellerStore` import (line 4) and replace:

```tsx
export default function ComissoesPage() {
  const { token } = useSellerStore()
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [totals, setTotals] = useState<Totals>({ grossAmount: 0, commissionAmount: 0, sellerPayout: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    getSellerCommissions(token)
      .then((data) => {
        setCommissions(data.commissions as Commission[])
        setTotals(data.totals)
      })
      .finally(() => setLoading(false))
  }, [token])
```

With:

```tsx
export default function ComissoesPage() {
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [totals, setTotals] = useState<Totals>({ grossAmount: 0, commissionAmount: 0, sellerPayout: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSellerCommissions()
      .then((data) => {
        setCommissions(data.commissions as Commission[])
        setTotals(data.totals)
      })
      .finally(() => setLoading(false))
  }, [])
```

- [ ] **Step 5: `pedidos/page.tsx` — drop the store import and token guard**

In `apps/storefront/src/app/painel/pedidos/page.tsx`, remove the `useSellerStore` import (line 4) and replace:

```tsx
export default function PedidosPage() {
  const { token } = useSellerStore()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    getSellerOrders(token)
      .then((data) => setOrders(data.orders as Order[]))
      .finally(() => setLoading(false))
  }, [token])
```

With:

```tsx
export default function PedidosPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSellerOrders()
      .then((data) => setOrders(data.orders as Order[]))
      .finally(() => setLoading(false))
  }, [])
```

- [ ] **Step 6: `dashboard/page.tsx` — drop `token`, keep `seller` for the greeting**

In `apps/storefront/src/app/painel/dashboard/page.tsx`, replace:

```tsx
export default function DashboardPage() {
  const { token, seller } = useSellerStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    getDashboard(token)
      .then((data) => setStats(data.stats))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])
```

With:

```tsx
export default function DashboardPage() {
  const { seller } = useSellerStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getDashboard()
      .then((data) => setStats(data.stats))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
```

- [ ] **Step 7: `perfil/page.tsx` — drop `token`, keep `seller`/`updateSeller`**

In `apps/storefront/src/app/painel/perfil/page.tsx`, replace:

```tsx
export default function PerfilPage() {
  const { token, seller, updateSeller } = useSellerStore()
```

With:

```tsx
export default function PerfilPage() {
  const { seller, updateSeller } = useSellerStore()
```

Replace:

```tsx
  useEffect(() => {
    if (!token) return
    getMe(token)
      .then((data) => {
```

With:

```tsx
  useEffect(() => {
    getMe()
      .then((data) => {
```

Replace `}, [token])` (the one closing the profile-loading effect, around line 55) with `}, [])`.

Replace:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setSaving(true)
    try {
      const data = await patchMe(token, form)
```

With:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const data = await patchMe(form)
```

- [ ] **Step 8: Update `produtos/novo/__tests__/page.test.tsx` for the new call signature**

In `apps/storefront/src/app/painel/produtos/novo/__tests__/page.test.tsx`, after Step 3 the page under test no longer imports or calls `useSellerStore` at all, so remove the mock entirely rather than update its shape. Delete:

```tsx
vi.mock("@/lib/seller-store", () => ({
  useSellerStore: () => ({ token: "test-token" }),
}))
```

Replace both occurrences of:

```tsx
    expect(createSellerProduct).toHaveBeenCalledWith("test-token", expect.objectContaining({
```

With:

```tsx
    expect(createSellerProduct).toHaveBeenCalledWith(expect.objectContaining({
```

(These are the two assertions in "converts the price to cents and submits the product, then navigates to the list" and "includes the selected category id in the submitted product".)

- [ ] **Step 9: Update `produtos/[id]/__tests__/page.test.tsx` for the new call signature**

In `apps/storefront/src/app/painel/produtos/[id]/__tests__/page.test.tsx`, after Step 2 the page under test no longer imports or calls `useSellerStore` at all, so remove the mock entirely rather than update its shape. Delete:

```tsx
vi.mock("@/lib/seller-store", () => ({
  useSellerStore: () => ({ token: "test-token" }),
}))
```

Replace:

```tsx
    expect(updateSellerProduct).toHaveBeenCalledWith("test-token", "prod_1", expect.objectContaining({
```

With:

```tsx
    expect(updateSellerProduct).toHaveBeenCalledWith("prod_1", expect.objectContaining({
```

- [ ] **Step 10: Run the full frontend suite**

Run: `cd apps/storefront && pnpm test`
Expected: all tests PASS, including the two updated page tests and everything from Tasks 5-8.

- [ ] **Step 11: Manual smoke check (dev server)**

Run: `cd apps/storefront && pnpm dev` (with the backend running locally too, `cd packages/medusa-backend/apps/backend && pnpm dev`). Log in at `/painel/login` with a seeded seller (e.g. Ailton's `adm@fixsistemas.com` / `FixSistemas@2026` from `docs/qa/2026-08-25-multi-seller-order-test.md`), confirm the dashboard loads, open DevTools → Application → Cookies and confirm `seller_session` shows `HttpOnly` checked and is not readable from `document.cookie` in the console. Click "Sair", confirm the cookie disappears and `/painel/dashboard` redirects back to login.

- [ ] **Step 12: Commit**

```bash
git add apps/storefront/src/app/painel
git commit -m "fix(fiscal): páginas do painel do vendedor não recebem mais token manualmente"
```

---

## Self-Review Notes

- **Spec coverage**: every spec section has a task — cookie shape (Task 1), login (Task 2), logout (Task 3), middleware (Task 4), `seller-api.ts` (Task 5), `seller-store.ts` (Task 6), route guard (Task 7), login page (Task 8), remaining pages (Task 9). The `Path=/api` → `Path=/` deviation is called out at the top, not silently changed.
- **Type consistency checked**: `SellerProfile` (Task 6) is the same shape `setSeller`/`updateSeller` (Task 6) and `layout.tsx`'s `getMe()` cast (Task 7) use; `getMe`/`patchMe`/`getDashboard`/`getSellerProducts`/`getSellerProduct`/`createSellerProduct`/`updateSellerProduct`/`deleteSellerProduct`/`getSellerOrders`/`getSellerCommissions` signatures defined in Task 5 match every call site updated in Tasks 7-9 exactly (parameter order, no leftover `token` argument anywhere).
- **No placeholders**: every step has real, complete code — no "add validation"-style steps.
