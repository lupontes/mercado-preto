# SaaS Sandbox Guard-Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that the OCI test environment (`teste.mercadopreto.com.br`) can never cause a real charge, real fiscal document, or a real e-mail/WhatsApp reaching a real customer, by introducing a dedicated `MARKETPLACE_SANDBOX` flag with startup validation and per-integration safe-mode behavior.

**Architecture:** A single utility `isSandboxMode()` (`src/utils/sandbox.ts`) is the one place that reads `MARKETPLACE_SANDBOX`; every other file calls it instead of reading `process.env` directly. A new `validateEnv()` (`src/utils/validate-env.ts`) runs at backend boot (from `medusa-config.ts`, replacing the existing inline required-vars loop) and throws if MercadoPago/Focus NFe credentials don't match the declared sandbox/production mode, or if `CLEARSALE_WEBHOOK_SECRET` is missing. Melhor Envio, Brevo and Evolution/WhatsApp each get sandbox-aware behavior at their call sites.

**Tech Stack:** TypeScript, Medusa v2, Jest (`@swc/jest`), Node `crypto`.

## Global Constraints

- New flag: `MARKETPLACE_SANDBOX` (string `"true"`/`"false"`), read **only** via `isSandboxMode()` in `src/utils/sandbox.ts` — no other file reads `process.env.MARKETPLACE_SANDBOX` directly.
- Default when `MARKETPLACE_SANDBOX` is unset or any value other than `"false"`: sandbox mode (`true`). Fail-safe — only an explicit `"false"` unlocks production behavior.
- Startup validation is fail-fast (`throw`, same pattern as the existing `JWT_SECRET`/`COOKIE_SECRET`/`DATABASE_URL` check in `medusa-config.ts`) — never a warn-and-continue.
- Test files live in `__tests__/` next to the file they test, named `*.unit.spec.ts`, using Jest globals (`describe`/`it`/`jest.fn()`, no imports needed) — matches every existing test in this repo.
- Run a single test file with:
  ```bash
  cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand <path-to-file>
  ```

---

## Task 1: `isSandboxMode()` utility

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/sandbox.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/sandbox.unit.spec.ts`

**Interfaces:**
- Produces: `isSandboxMode(): boolean` — exported from `src/utils/sandbox.ts`. Every later task imports this.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/utils/__tests__/sandbox.unit.spec.ts`:

```ts
import { isSandboxMode } from "../sandbox"

describe("isSandboxMode", () => {
  const original = process.env.MARKETPLACE_SANDBOX

  afterEach(() => {
    if (original === undefined) delete process.env.MARKETPLACE_SANDBOX
    else process.env.MARKETPLACE_SANDBOX = original
  })

  it("returns true when MARKETPLACE_SANDBOX is unset (fail-safe default)", () => {
    delete process.env.MARKETPLACE_SANDBOX
    expect(isSandboxMode()).toBe(true)
  })

  it("returns true when MARKETPLACE_SANDBOX=true", () => {
    process.env.MARKETPLACE_SANDBOX = "true"
    expect(isSandboxMode()).toBe(true)
  })

  it("returns false when MARKETPLACE_SANDBOX=false", () => {
    process.env.MARKETPLACE_SANDBOX = "false"
    expect(isSandboxMode()).toBe(false)
  })

  it("returns true (fail-safe) for an unexpected value", () => {
    process.env.MARKETPLACE_SANDBOX = "nope"
    expect(isSandboxMode()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand src/utils/__tests__/sandbox.unit.spec.ts`
Expected: FAIL — `Cannot find module '../sandbox'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/medusa-backend/apps/backend/src/utils/sandbox.ts`:

```ts
export function isSandboxMode(): boolean {
  return process.env.MARKETPLACE_SANDBOX !== "false"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/sandbox.ts packages/medusa-backend/apps/backend/src/utils/__tests__/sandbox.unit.spec.ts
git commit -m "feat(backend): add isSandboxMode() as single source of truth for sandbox mode"
```

---

## Task 2: `validateEnv()` — startup fail-fast validation

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/validate-env.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/validate-env.unit.spec.ts`

**Interfaces:**
- Consumes: `isSandboxMode()` from Task 1.
- Produces: `validateEnv(): void` — throws `Error` on any violation. Task 3 calls this from `medusa-config.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/utils/__tests__/validate-env.unit.spec.ts`:

```ts
import { validateEnv } from "../validate-env"

function setBaseValidEnv() {
  process.env.JWT_SECRET = "jwt-secret"
  process.env.COOKIE_SECRET = "cookie-secret"
  process.env.DATABASE_URL = "postgres://localhost/test"
  process.env.CLEARSALE_WEBHOOK_SECRET = "clearsale-secret"
  delete process.env.MARKETPLACE_SANDBOX
  delete process.env.MERCADOPAGO_ACCESS_TOKEN
  delete process.env.FOCUS_NFE_TOKEN
  delete process.env.FOCUS_NFE_SANDBOX
}

describe("validateEnv", () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  describe("required env vars", () => {
    it.each(["JWT_SECRET", "COOKIE_SECRET", "DATABASE_URL", "CLEARSALE_WEBHOOK_SECRET"])(
      "throws when %s is missing",
      (key) => {
        setBaseValidEnv()
        delete process.env[key as string]
        expect(() => validateEnv()).toThrow(`Missing required environment variable: ${key}`)
      }
    )

    it("does not throw when all required vars are set and no optional integrations are configured", () => {
      setBaseValidEnv()
      expect(() => validateEnv()).not.toThrow()
    })
  })

  describe("MercadoPago sandbox consistency", () => {
    it("passes when sandbox mode (default) and token starts with TEST-", () => {
      setBaseValidEnv()
      process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-abc123"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when sandbox mode (default) and token looks like production", () => {
      setBaseValidEnv()
      process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-abc123"
      expect(() => validateEnv()).toThrow(/MERCADOPAGO_ACCESS_TOKEN/)
    })

    it("passes when MARKETPLACE_SANDBOX=false and token does not start with TEST-", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-abc123"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when MARKETPLACE_SANDBOX=false and token starts with TEST-", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-abc123"
      expect(() => validateEnv()).toThrow(/MERCADOPAGO_ACCESS_TOKEN/)
    })

    it("does not validate when MERCADOPAGO_ACCESS_TOKEN is unset", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      expect(() => validateEnv()).not.toThrow()
    })
  })

  describe("Focus NFe sandbox consistency", () => {
    it("passes when sandbox mode (default) and FOCUS_NFE_SANDBOX=true", () => {
      setBaseValidEnv()
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "true"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when sandbox mode (default) and FOCUS_NFE_SANDBOX=false", () => {
      setBaseValidEnv()
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "false"
      expect(() => validateEnv()).toThrow(/FOCUS_NFE_SANDBOX/)
    })

    it("passes when MARKETPLACE_SANDBOX=false and FOCUS_NFE_SANDBOX=false", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "false"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when MARKETPLACE_SANDBOX=false and FOCUS_NFE_SANDBOX=true", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "true"
      expect(() => validateEnv()).toThrow(/FOCUS_NFE_SANDBOX/)
    })

    it("does not validate when FOCUS_NFE_TOKEN is unset", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.FOCUS_NFE_SANDBOX = "true"
      expect(() => validateEnv()).not.toThrow()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand src/utils/__tests__/validate-env.unit.spec.ts`
Expected: FAIL — `Cannot find module '../validate-env'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/medusa-backend/apps/backend/src/utils/validate-env.ts`:

```ts
import { isSandboxMode } from "./sandbox"

const REQUIRED_ENV_VARS = ["JWT_SECRET", "COOKIE_SECRET", "DATABASE_URL", "CLEARSALE_WEBHOOK_SECRET"] as const

export function validateEnv(): void {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}. Set it in your .env file.`)
    }
  }

  const sandbox = isSandboxMode()

  const mercadopagoToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (mercadopagoToken) {
    const looksLikeTestToken = mercadopagoToken.startsWith("TEST-")
    if (sandbox && !looksLikeTestToken) {
      throw new Error(
        "MERCADOPAGO_ACCESS_TOKEN looks like a production token (doesn't start with 'TEST-') but MARKETPLACE_SANDBOX is not 'false'. Use a sandbox token or set MARKETPLACE_SANDBOX=false."
      )
    }
    if (!sandbox && looksLikeTestToken) {
      throw new Error(
        "MERCADOPAGO_ACCESS_TOKEN is a sandbox token (starts with 'TEST-') but MARKETPLACE_SANDBOX=false. Use a production token."
      )
    }
  }

  const focusNfeToken = process.env.FOCUS_NFE_TOKEN
  if (focusNfeToken) {
    const focusNfeSandbox = process.env.FOCUS_NFE_SANDBOX === "true"
    if (sandbox && !focusNfeSandbox) {
      throw new Error(
        "FOCUS_NFE_SANDBOX must be 'true' when MARKETPLACE_SANDBOX is not 'false' (sandbox mode). Set FOCUS_NFE_SANDBOX=true."
      )
    }
    if (!sandbox && focusNfeSandbox) {
      throw new Error(
        "FOCUS_NFE_SANDBOX is 'true' but MARKETPLACE_SANDBOX=false (production mode). Set FOCUS_NFE_SANDBOX=false."
      )
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/validate-env.ts packages/medusa-backend/apps/backend/src/utils/__tests__/validate-env.unit.spec.ts
git commit -m "feat(backend): add fail-fast sandbox/production consistency validation"
```

---

## Task 3: Wire `validateEnv()` into `medusa-config.ts`

**Files:**
- Modify: `packages/medusa-backend/apps/backend/medusa-config.ts:1-10`

**Interfaces:**
- Consumes: `validateEnv()` from Task 2.

- [ ] **Step 1: Replace the inline required-vars loop with `validateEnv()`**

In `packages/medusa-backend/apps/backend/medusa-config.ts`, replace lines 1-10:

```ts
import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const requiredEnvVars = ['JWT_SECRET', 'COOKIE_SECRET', 'DATABASE_URL'] as const
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}. Set it in your .env file.`)
  }
}
```

with:

```ts
import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { validateEnv } from './src/utils/validate-env'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

validateEnv()
```

The rest of the file (`module.exports = defineConfig({...})`) is unchanged.

- [ ] **Step 2: Verify no test imports this file directly**

Run: `grep -rln "medusa-config" packages/medusa-backend/apps/backend/src packages/medusa-backend/apps/backend/integration-tests`
Expected: no results referencing the actual config file (confirms this change can't break the Jest suite — `medusa-config.ts` is only loaded by the Medusa CLI, not by any test).

- [ ] **Step 3: Manually verify the backend still boots locally**

Run: `cd packages/medusa-backend/apps/backend && timeout 20 npx medusa develop 2>&1 | head -40`
Expected: no `Missing required environment variable` or sandbox-mismatch error in the output before the timeout kills it — the local `.env` already has `MERCADOPAGO_ACCESS_TOKEN=TEST-...`, `FOCUS_NFE_SANDBOX=true`, and `CLEARSALE_WEBHOOK_SECRET` set, so `validateEnv()` should pass silently and the normal Medusa startup log should appear instead.

- [ ] **Step 4: Commit**

```bash
git add packages/medusa-backend/apps/backend/medusa-config.ts
git commit -m "feat(backend): run sandbox/production env validation on backend boot"
```

---

## Task 4: Melhor Envio — sandbox URL driven by `MARKETPLACE_SANDBOX`, not `NODE_ENV`

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/shipping/estimate/route.ts:25-27`
- Modify: `packages/medusa-backend/apps/backend/src/api/store/shipping/estimate/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `isSandboxMode()` from Task 1.

- [ ] **Step 1: Update the existing tests to assert on `MARKETPLACE_SANDBOX` instead of `NODE_ENV`**

In `packages/medusa-backend/apps/backend/src/api/store/shipping/estimate/__tests__/route.unit.spec.ts`, change the `makeReq` default env (lines 3-11):

```ts
const makeReq = (query: Record<string, string>, env: Record<string, string> = {}) => {
  Object.assign(process.env, {
    MELHOR_ENVIO_TOKEN: "",
    MELHOR_ENVIO_ORIGIN_CEP: "44300000",
    MARKETPLACE_SANDBOX: "true",
    ...env,
  })
  return { query } as any
}
```

Then replace the two `NODE_ENV`-based tests (currently named `"calls sandbox URL in development"` and `"calls production URL in production"`, lines 89-112):

```ts
    it("calls sandbox URL when MARKETPLACE_SANDBOX is true (default)", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([{ id: 1, name: "PAC", company: { name: "Correios" }, price: "12.50", delivery_time: 7 }]),
      })

      await GET(makeReq({ cep: "01310100" }, withToken), makeRes())

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
      expect(calledUrl).toContain("sandbox.melhorenvio.com.br")
    })

    it("calls production URL when MARKETPLACE_SANDBOX=false", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      })

      await GET(makeReq({ cep: "01310100" }, { ...withToken, MARKETPLACE_SANDBOX: "false" }), makeRes())

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
      expect(calledUrl).toContain("melhorenvio.com.br")
      expect(calledUrl).not.toContain("sandbox")
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand src/api/store/shipping/estimate/__tests__/route.unit.spec.ts`
Expected: FAIL on `"calls production URL when MARKETPLACE_SANDBOX=false"` — the route still branches on `NODE_ENV`, which Jest leaves as `"test"` (never `"production"`), so it still calls the sandbox URL even though the test sets `MARKETPLACE_SANDBOX=false`. (The sibling `"calls sandbox URL when MARKETPLACE_SANDBOX is true (default)"` test already passes against the unmodified route — `NODE_ENV !== "production"` under Jest picks the sandbox branch either way — that's expected and fine; the point of this step is the one genuine red test.)

- [ ] **Step 3: Update the route to use `isSandboxMode()`**

In `packages/medusa-backend/apps/backend/src/api/store/shipping/estimate/route.ts`, add the import at the top:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isSandboxMode } from "../../../../utils/sandbox"
```

Replace lines 25-27:

```ts
      const baseUrl = process.env.NODE_ENV === "production"
        ? "https://melhorenvio.com.br"
        : "https://sandbox.melhorenvio.com.br"
```

with:

```ts
      const baseUrl = isSandboxMode()
        ? "https://sandbox.melhorenvio.com.br"
        : "https://melhorenvio.com.br"
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/shipping/estimate/route.ts packages/medusa-backend/apps/backend/src/api/store/shipping/estimate/__tests__/route.unit.spec.ts
git commit -m "fix(backend): drive Melhor Envio sandbox URL from MARKETPLACE_SANDBOX instead of NODE_ENV"
```

---

## Task 5: WhatsApp (Evolution API) — redirect to test recipient in sandbox mode

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/utils/whatsapp.ts`
- Create: `packages/medusa-backend/apps/backend/src/utils/__tests__/whatsapp.unit.spec.ts`

**Interfaces:**
- Consumes: `isSandboxMode()` from Task 1.
- Produces: `sendWhatsApp(phone: string, message: string): Promise<void>` — unchanged signature. Task 6 imports this.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/utils/__tests__/whatsapp.unit.spec.ts`:

```ts
import { sendWhatsApp } from "../whatsapp"

function setBaseEnv(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    EVOLUTION_API_URL: "https://evolution.example.com",
    EVOLUTION_API_KEY: "evo-key",
    EVOLUTION_API_INSTANCE: "mercadopreto",
    MARKETPLACE_SANDBOX: "true",
    TEST_WHATSAPP_RECIPIENT: "5511999999999",
  }
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe("sendWhatsApp", () => {
  const original = { ...process.env }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("does nothing when Evolution API is not configured", async () => {
    setBaseEnv({ EVOLUTION_API_URL: undefined })
    await sendWhatsApp("5571988887777", "hi")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("redirects to TEST_WHATSAPP_RECIPIENT in sandbox mode instead of the real number", async () => {
    setBaseEnv()
    await sendWhatsApp("5571988887777", "hi")

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.number).toBe("5511999999999")
    expect(body.number).not.toBe("5571988887777")
  })

  it("does not send and logs an error when sandbox mode has no TEST_WHATSAPP_RECIPIENT configured", async () => {
    setBaseEnv({ TEST_WHATSAPP_RECIPIENT: undefined })
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    await sendWhatsApp("5571988887777", "hi")

    expect(global.fetch).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("sends to the real phone number when MARKETPLACE_SANDBOX=false", async () => {
    setBaseEnv({ MARKETPLACE_SANDBOX: "false" })
    await sendWhatsApp("71988887777", "hi")

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.number).toBe("5571988887777")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand src/utils/__tests__/whatsapp.unit.spec.ts`
Expected: FAIL — sandbox redirect tests fail because the current implementation always uses the real phone number.

- [ ] **Step 3: Implement the redirect**

Replace the full contents of `packages/medusa-backend/apps/backend/src/utils/whatsapp.ts`:

```ts
import { isSandboxMode } from "./sandbox"

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const apiUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_API_INSTANCE

  if (!apiUrl || !apiKey || !instance) return

  let targetPhone = phone
  if (isSandboxMode()) {
    const testRecipient = process.env.TEST_WHATSAPP_RECIPIENT
    if (!testRecipient) {
      console.error(
        "[sandbox] TEST_WHATSAPP_RECIPIENT não configurado — WhatsApp não enviado (destinatário real bloqueado em modo sandbox)"
      )
      return
    }
    targetPhone = testRecipient
  }

  const digits = targetPhone.replace(/\D/g, "")
  const normalized = digits.startsWith("55") ? digits : `55${digits}`

  await fetch(`${apiUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number: normalized, text: message }),
  }).catch(() => {})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/whatsapp.ts packages/medusa-backend/apps/backend/src/utils/__tests__/whatsapp.unit.spec.ts
git commit -m "feat(backend): redirect WhatsApp messages to a test recipient in sandbox mode"
```

---

## Task 6: Typebot webhook — stop duplicating WhatsApp send logic

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/webhooks/typebot/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/store/webhooks/typebot/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: `sendWhatsApp(phone: string, message: string): Promise<void>` from Task 5.

This route currently has its own copy of the Evolution API call (`sendEvolutionMessage`, lines 16-30 of the current file), which means it never got the sandbox redirect added in Task 5. Deduplicating it onto the shared `sendWhatsApp` fixes that gap as a side effect — it's the only call site left that could leak a real WhatsApp message.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/store/webhooks/typebot/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"

function makeReq(body: any) {
  return {
    headers: {},
    body,
    scope: { resolve: () => ({ listSellers: jest.fn().mockResolvedValue([]) }) },
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.sendStatus = (code: number) => { res._status = code; return res }
  return res
}

describe("POST /store/webhooks/typebot", () => {
  const original = { ...process.env }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
    process.env.EVOLUTION_API_URL = "https://evolution.example.com"
    process.env.EVOLUTION_API_KEY = "evo-key"
    process.env.EVOLUTION_API_INSTANCE = "mercadopreto"
    process.env.MARKETPLACE_SANDBOX = "true"
    process.env.TEST_WHATSAPP_RECIPIENT = "5511999999999"
    delete process.env.EVOLUTION_WEBHOOK_SECRET
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("redirects the FAQ reply to TEST_WHATSAPP_RECIPIENT in sandbox mode instead of the real sender", async () => {
    const body = {
      event: "messages.upsert",
      data: {
        key: { remoteJid: "557199990000", fromMe: false },
        message: { conversation: "qual o horario de atendimento?" },
      },
    }

    await POST(makeReq(body), makeRes())

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(sentBody.number).toBe("5511999999999")
    expect(sentBody.number).not.toBe("557199990000")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand src/api/store/webhooks/typebot/__tests__/route.unit.spec.ts`
Expected: FAIL — the route's own `sendEvolutionMessage` doesn't know about sandbox mode yet, so `sentBody.number` is `"557199990000"`, not the test recipient.

- [ ] **Step 3: Replace the local send function with the shared `sendWhatsApp`**

In `packages/medusa-backend/apps/backend/src/api/store/webhooks/typebot/route.ts`, replace the imports (lines 1-3):

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"
```

with:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"
import { sendWhatsApp } from "../../../../utils/whatsapp"
```

Remove the local `sendEvolutionMessage` function entirely (lines 16-30):

```ts
async function sendEvolutionMessage(phone: string, message: string): Promise<void> {
  const apiUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_API_INSTANCE
  if (!apiUrl || !apiKey || !instance) return

  const digits = phone.replace(/\D/g, "")
  const normalized = digits.startsWith("55") ? digits : `55${digits}`

  await fetch(`${apiUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number: normalized, text: message }),
  }).catch(() => {})
}
```

Then replace every call to `sendEvolutionMessage(` with `sendWhatsApp(` (three call sites, in the FAQ branch, the seller-list branch, and the default-reply branch at the end of `POST`) — signature is identical (`phone: string, message: string`), so only the function name changes.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Run the full unit suite to confirm no regression**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/store/webhooks/typebot/route.ts packages/medusa-backend/apps/backend/src/api/store/webhooks/typebot/__tests__/route.unit.spec.ts
git commit -m "refactor(backend): dedupe typebot webhook onto shared sendWhatsApp (fixes missing sandbox redirect)"
```

---

## Task 7: Brevo e-mail — redirect to test recipient in sandbox mode

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/seller-approved-email.ts`
- Create: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/seller-approved-email.unit.spec.ts`

**Interfaces:**
- Consumes: `isSandboxMode()` from Task 1.

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/subscribers/__tests__/seller-approved-email.unit.spec.ts`:

```ts
import sellerApprovedEmail from "../seller-approved-email"

function makeContainer(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

const seller = {
  id: "seller_1",
  email: "loja-real@example.com",
  ownerName: "Fulana",
  name: "Loja Real",
}

describe("sellerApprovedEmail", () => {
  const original = { ...process.env }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
    process.env.BREVO_API_KEY = "brevo-key"
    process.env.MARKETPLACE_SANDBOX = "true"
    process.env.TEST_EMAIL_RECIPIENT = "tester@mercadopreto.com.br"
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("does nothing when BREVO_API_KEY is not configured", async () => {
    delete process.env.BREVO_API_KEY
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("redirects to TEST_EMAIL_RECIPIENT in sandbox mode instead of the seller's real email", async () => {
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.to).toEqual([{ email: "tester@mercadopreto.com.br" }])
  })

  it("does not send and logs an error when sandbox mode has no TEST_EMAIL_RECIPIENT configured", async () => {
    delete process.env.TEST_EMAIL_RECIPIENT
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("sends to the seller's real email when MARKETPLACE_SANDBOX=false", async () => {
    process.env.MARKETPLACE_SANDBOX = "false"
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.to).toEqual([{ email: "loja-real@example.com" }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand src/subscribers/__tests__/seller-approved-email.unit.spec.ts`
Expected: FAIL — the sandbox-redirect and no-recipient tests fail because the current implementation always e-mails the seller's real address.

- [ ] **Step 3: Implement the redirect**

In `packages/medusa-backend/apps/backend/src/subscribers/seller-approved-email.ts`, replace lines 1-22:

```ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"

async function sendBrevoEmail(to: string, subject: string, htmlContent: string) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Mercado Preto", email: process.env.EMAIL_FROM || "noreply@mercadopreto.com.br" },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  })
}
```

with:

```ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"
import { isSandboxMode } from "../utils/sandbox"

async function sendBrevoEmail(to: string, subject: string, htmlContent: string) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return

  let recipient = to
  if (isSandboxMode()) {
    const testRecipient = process.env.TEST_EMAIL_RECIPIENT
    if (!testRecipient) {
      console.error(
        "[sandbox] TEST_EMAIL_RECIPIENT não configurado — e-mail não enviado (destinatário real bloqueado em modo sandbox)"
      )
      return
    }
    recipient = testRecipient
  }

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Mercado Preto", email: process.env.EMAIL_FROM || "noreply@mercadopreto.com.br" },
      to: [{ email: recipient }],
      subject,
      htmlContent,
    }),
  })
}
```

The rest of the file (`sellerApprovedEmail`, `config`) is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/subscribers/seller-approved-email.ts packages/medusa-backend/apps/backend/src/subscribers/__tests__/seller-approved-email.unit.spec.ts
git commit -m "feat(backend): redirect seller-approval emails to a test recipient in sandbox mode"
```

---

## Task 8: ClearSale webhook — required secret + constant-time comparison

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/webhooks/clearsale/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/admin/webhooks/clearsale/__tests__/route.unit.spec.ts`

Not sandbox-specific — a security fix identified during this investigation (the webhook accepts any request unauthenticated when `CLEARSALE_WEBHOOK_SECRET` is unset, and uses a non-constant-time string comparison when it is set). `validateEnv()` from Task 2 already guarantees the secret is always present at runtime, so the route no longer needs to handle the "unset" case.

**Interfaces:**
- Consumes: nothing new (Node's built-in `crypto`).

- [ ] **Step 1: Write the failing test**

Create `packages/medusa-backend/apps/backend/src/api/admin/webhooks/clearsale/__tests__/route.unit.spec.ts`:

```ts
import { POST } from "../route"

function makeReq(secretHeader: string | undefined, body: any = {}) {
  return {
    headers: secretHeader !== undefined ? { "x-clearsale-secret": secretHeader } : {},
    body,
    scope: { resolve: () => ({}) },
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /admin/webhooks/clearsale", () => {
  const original = process.env.CLEARSALE_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.CLEARSALE_WEBHOOK_SECRET = "correct-secret"
  })

  afterEach(() => {
    process.env.CLEARSALE_WEBHOOK_SECRET = original
  })

  it("returns 401 when the secret header is missing", async () => {
    const res = makeRes()
    await POST(makeReq(undefined), res)
    expect(res._status).toBe(401)
  })

  it("returns 401 when the secret header does not match", async () => {
    const res = makeRes()
    await POST(makeReq("wrong-secret"), res)
    expect(res._status).toBe(401)
  })

  it("returns 401 when the secret header is a different length than the real secret", async () => {
    const res = makeRes()
    await POST(makeReq("short"), res)
    expect(res._status).toBe(401)
  })

  it("passes auth and returns 400 for a valid secret but missing order_id", async () => {
    const res = makeRes()
    await POST(makeReq("correct-secret", {}), res)
    expect(res._status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test against the current code**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand src/api/admin/webhooks/clearsale/__tests__/route.unit.spec.ts`
Expected: **PASS** — with `CLEARSALE_WEBHOOK_SECRET` always set (as `beforeEach` does here), the existing `!==` comparison already rejects a missing/wrong/wrong-length header the same way `timingSafeEqual` would; there's no black-box functional difference for a *configured* secret. This task's fix is a non-functional hardening (constant-time comparison, closing a timing side-channel) plus removing the `if (secret)` bypass path for when the secret is *unset* — a scenario `validateEnv()` (Task 2/3) now guarantees can't happen at boot, so it deliberately isn't tested here (per this repo's "don't validate scenarios that can't happen" convention, matching the existing `MERCADOPAGO_ACCESS_TOKEN!` non-null assertion in `src/modules/mercadopago/provider.ts:41`). These tests exist to lock in correct behavior as a regression guard, not to prove a red→green transition.

- [ ] **Step 3: Implement constant-time comparison**

In `packages/medusa-backend/apps/backend/src/api/admin/webhooks/clearsale/route.ts`, replace lines 1-11:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const secret = process.env.CLEARSALE_WEBHOOK_SECRET
  if (secret) {
    const incomingSecret = req.headers["x-clearsale-secret"] as string | undefined
    if (incomingSecret !== secret) {
      return res.status(401).json({ error: "Unauthorized" })
    }
  }
```

with:

```ts
import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function verifySecret(req: MedusaRequest, secret: string): boolean {
  const incoming = req.headers["x-clearsale-secret"] as string | undefined
  if (!incoming) return false

  const incomingBuf = Buffer.from(incoming)
  const secretBuf = Buffer.from(secret)
  if (incomingBuf.length !== secretBuf.length) return false

  return crypto.timingSafeEqual(incomingBuf, secretBuf)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // validateEnv() (src/utils/validate-env.ts) guarantees this is always set at boot.
  const secret = process.env.CLEARSALE_WEBHOOK_SECRET!
  if (!verifySecret(req, secret)) {
    return res.status(401).json({ error: "Unauthorized" })
  }
```

The rest of the function (`order_id` check onward) is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/webhooks/clearsale/route.ts packages/medusa-backend/apps/backend/src/api/admin/webhooks/clearsale/__tests__/route.unit.spec.ts
git commit -m "fix(backend): require ClearSale webhook secret and compare it in constant time"
```

---

## Task 9: Document new env vars in both `.env.template` files

**Files:**
- Modify: `infra/.env.template` (seeds the OCI server's `.env`, read by `docker-compose.prod.yml`)
- Modify: `packages/medusa-backend/apps/backend/.env.template` (seeds a local dev `.env`)

No tests — documentation-only change to the two tracked templates that seed new `.env` files. Both need the same new vars since they're independent copies (confirmed by reading both — they already drift slightly, e.g. `FOCUS_NFE_SANDBOX` default is already `true` in the backend one but `false` in the infra one).

- [ ] **Step 1: Add the `MARKETPLACE_SANDBOX` section**

In `infra/.env.template`, after the "Segurança do Medusa" block (after the `COOKIE_SECRET=troque_por_outra_string_aleatoria` line) and before the "CORS" block, insert:

```
# -----------------------------------------------------------------------------
# Modo sandbox — controla o comportamento de negócio de TODAS as integrações
# SaaS (MercadoPago, Focus NFe, Melhor Envio, Brevo, Evolution/WhatsApp).
# Ausente ou qualquer valor != "false" = sandbox (nenhum efeito real). Só
# "false" libera comportamento de produção. Ver src/utils/validate-env.ts —
# o backend recusa subir se MERCADOPAGO_ACCESS_TOKEN/FOCUS_NFE_SANDBOX não
# baterem com este modo.
# -----------------------------------------------------------------------------
MARKETPLACE_SANDBOX=true

```

- [ ] **Step 2: Fix the `FOCUS_NFE_SANDBOX` default and add a comment**

Replace:

```
FOCUS_NFE_TOKEN=
FOCUS_NFE_SANDBOX=false
```

with:

```
FOCUS_NFE_TOKEN=
# Deve bater com MARKETPLACE_SANDBOX (ver acima) — o backend recusa subir se não bater.
FOCUS_NFE_SANDBOX=true
```

- [ ] **Step 3: Add `TEST_EMAIL_RECIPIENT` next to Brevo**

Replace:

```
# -----------------------------------------------------------------------------
# Brevo — e-mail transacional [OPCIONAL]
# Sem API key, e-mails de aprovação de seller são ignorados.
# Obter em: https://app.brevo.com/settings/keys/api
# -----------------------------------------------------------------------------
BREVO_API_KEY=
EMAIL_FROM=noreply@mercadopreto.com.br
```

with:

```
# -----------------------------------------------------------------------------
# Brevo — e-mail transacional [OPCIONAL]
# Sem API key, e-mails de aprovação de seller são ignorados.
# Obter em: https://app.brevo.com/settings/keys/api
# Em modo sandbox (ver MARKETPLACE_SANDBOX acima), todo e-mail é redirecionado
# para TEST_EMAIL_RECIPIENT em vez do destinatário real.
# -----------------------------------------------------------------------------
BREVO_API_KEY=
EMAIL_FROM=noreply@mercadopreto.com.br
TEST_EMAIL_RECIPIENT=
```

- [ ] **Step 4: Add `TEST_WHATSAPP_RECIPIENT` next to Evolution API**

Replace:

```
# -----------------------------------------------------------------------------
# Evolution API — WhatsApp [OPCIONAL]
# Notificações de pedido e aprovação via WhatsApp.
# Instância auto-hospedada no mesmo servidor ou externo.
# -----------------------------------------------------------------------------
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_API_INSTANCE=
EVOLUTION_WEBHOOK_SECRET=
```

with:

```
# -----------------------------------------------------------------------------
# Evolution API — WhatsApp [OPCIONAL]
# Notificações de pedido e aprovação via WhatsApp.
# Instância auto-hospedada no mesmo servidor ou externo.
# Em modo sandbox (ver MARKETPLACE_SANDBOX acima), toda mensagem é redirecionada
# para TEST_WHATSAPP_RECIPIENT em vez do número real.
# -----------------------------------------------------------------------------
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_API_INSTANCE=
EVOLUTION_WEBHOOK_SECRET=
TEST_WHATSAPP_RECIPIENT=
```

- [ ] **Step 5: Update the ClearSale comment — now required, not optional**

Replace:

```
# -----------------------------------------------------------------------------
# ClearSale — antifraude [OPCIONAL]
# Sem a secret, o webhook aceita qualquer POST sem validação.
# Configure o webhook no painel ClearSale: POST /admin/webhooks/clearsale
# -----------------------------------------------------------------------------
CLEARSALE_WEBHOOK_SECRET=
```

with:

```
# -----------------------------------------------------------------------------
# ClearSale — antifraude [OBRIGATÓRIO]
# O backend recusa subir sem essa variável (ver src/utils/validate-env.ts).
# Configure o webhook no painel ClearSale: POST /admin/webhooks/clearsale
# -----------------------------------------------------------------------------
CLEARSALE_WEBHOOK_SECRET=
```

- [ ] **Step 6: Add the same `MARKETPLACE_SANDBOX` section to the backend template**

In `packages/medusa-backend/apps/backend/.env.template`, after the "Segurança" block (after the `COOKIE_SECRET=troque_por_outra_string_aleatoria_em_producao` line, line 27) and before the "CORS" block, insert:

```
# -----------------------------------------------------------------------------
# Modo sandbox — controla o comportamento de negócio de TODAS as integrações
# SaaS (MercadoPago, Focus NFe, Melhor Envio, Brevo, Evolution/WhatsApp).
# Ausente ou qualquer valor != "false" = sandbox (nenhum efeito real). Só
# "false" libera comportamento de produção. Ver src/utils/validate-env.ts —
# o backend recusa subir se MERCADOPAGO_ACCESS_TOKEN/FOCUS_NFE_SANDBOX não
# baterem com este modo.
# -----------------------------------------------------------------------------
MARKETPLACE_SANDBOX=true

```

- [ ] **Step 7: Add `TEST_EMAIL_RECIPIENT` to the backend template's Brevo block**

Replace (lines 86-93):

```
# -----------------------------------------------------------------------------
# Brevo — e-mail transacional [OPCIONAL]
# Sem esta configuração, e-mails (ex: aprovação de seller) são silenciosamente ignorados.
# Obter em: https://app.brevo.com/settings/keys/api
# EMAIL_FROM: deve ser um domínio verificado no Brevo
# -----------------------------------------------------------------------------
BREVO_API_KEY=
EMAIL_FROM=noreply@mercadopreto.com.br
```

with:

```
# -----------------------------------------------------------------------------
# Brevo — e-mail transacional [OPCIONAL]
# Sem esta configuração, e-mails (ex: aprovação de seller) são silenciosamente ignorados.
# Obter em: https://app.brevo.com/settings/keys/api
# EMAIL_FROM: deve ser um domínio verificado no Brevo
# Em modo sandbox (ver MARKETPLACE_SANDBOX acima), todo e-mail é redirecionado
# para TEST_EMAIL_RECIPIENT em vez do destinatário real.
# -----------------------------------------------------------------------------
BREVO_API_KEY=
EMAIL_FROM=noreply@mercadopreto.com.br
TEST_EMAIL_RECIPIENT=
```

- [ ] **Step 8: Add `TEST_WHATSAPP_RECIPIENT` to the backend template's Evolution block**

Replace (lines 95-104):

```
# -----------------------------------------------------------------------------
# Evolution API + WhatsApp [OPCIONAL]
# Sem estas vars, notificações WhatsApp são silenciosamente desativadas.
# Instância auto-hospedada — ver docker-compose.yml para Chatwoot/Evolution
# EVOLUTION_WEBHOOK_SECRET: validação de assinatura HMAC (pode deixar vazio)
# -----------------------------------------------------------------------------
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_API_INSTANCE=
EVOLUTION_WEBHOOK_SECRET=
```

with:

```
# -----------------------------------------------------------------------------
# Evolution API + WhatsApp [OPCIONAL]
# Sem estas vars, notificações WhatsApp são silenciosamente desativadas.
# Instância auto-hospedada — ver docker-compose.yml para Chatwoot/Evolution
# EVOLUTION_WEBHOOK_SECRET: validação de assinatura HMAC (pode deixar vazio)
# Em modo sandbox (ver MARKETPLACE_SANDBOX acima), toda mensagem é redirecionada
# para TEST_WHATSAPP_RECIPIENT em vez do número real.
# -----------------------------------------------------------------------------
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_API_INSTANCE=
EVOLUTION_WEBHOOK_SECRET=
TEST_WHATSAPP_RECIPIENT=
```

- [ ] **Step 9: Update the backend template's ClearSale comment — now required, not optional**

Replace (lines 106-112):

```
# -----------------------------------------------------------------------------
# ClearSale — antifraude [OPCIONAL]
# Sem esta var, o webhook do ClearSale não valida assinatura (aceita qualquer POST).
# Configure o webhook no painel ClearSale apontando para /admin/webhooks/clearsale
# CLEARSALE_WEBHOOK_SECRET: string secreta compartilhada com a ClearSale
# -----------------------------------------------------------------------------
CLEARSALE_WEBHOOK_SECRET=
```

with:

```
# -----------------------------------------------------------------------------
# ClearSale — antifraude [OBRIGATÓRIO]
# O backend recusa subir sem esta var (ver src/utils/validate-env.ts).
# Configure o webhook no painel ClearSale apontando para /admin/webhooks/clearsale
# CLEARSALE_WEBHOOK_SECRET: string secreta compartilhada com a ClearSale
# -----------------------------------------------------------------------------
CLEARSALE_WEBHOOK_SECRET=
```

- [ ] **Step 10: Commit**

```bash
git add infra/.env.template packages/medusa-backend/apps/backend/.env.template
git commit -m "docs: document MARKETPLACE_SANDBOX and new test-recipient env vars"
```

---

## Rollout (manual, after this plan's tasks are merged — not part of this plan's tasks)

These steps need real credentials and access to the OCI server, so they cannot be executed as part of this plan:

1. Merge this branch, deploy the rebuilt backend image to `teste.mercadopreto.com.br`.
2. Update the server's `infra/.env`: `MARKETPLACE_SANDBOX=true`, `MERCADOPAGO_ACCESS_TOKEN` set to the sandbox token already on file in `CREDENTIALS.md` (`TEST-4687726525202189-...`), `FOCUS_NFE_SANDBOX=true`, `TEST_EMAIL_RECIPIENT` and `TEST_WHATSAPP_RECIPIENT` filled in, `CLEARSALE_WEBHOOK_SECRET` set (now boot-required by this branch, was optional before).
3. Restart the backend container; confirm it boots (proves the sandbox validation passes with the real config).
4. Update `docs/qa/2026-07-12-admin-payouts-manual-test.md`: Teste 5 (pagamento) stops being a "falha esperada" — payment should now actually succeed via the sandbox MercadoPago token; unblock Parte 4 (fluxo completo de repasse) since real commissions can now be generated; add a note at the top of the document that it must be kept in sync with environment changes going forward.
