# Frete por Loja (Ciclo 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cotar o frete por loja (origem = endereço da base operacional de cada loja, peso/medidas reais), oferecer "Econômico" (PAC) e "Rápido" (SEDEX) somados no checkout, recalcular no servidor no pagamento e gravar o serviço por loja nos pedidos.

**Architecture:** Um núcleo puro `quoteShipping` (backend, `utils/shipping-quote.ts`) recebe variantes + CEP, carrega peso/medidas/loja do banco via `query.graph`, chama um calculador Melhor Envio injetável (`utils/melhor-envio.ts`) por loja em paralelo e monta as duas opções. A rota `POST /store/shipping/quote` expõe o núcleo; `resolveCheckoutShipping` o reutiliza na preferência Mercado Pago e no `sandbox-cash`, devolvendo 409/422 quando preço ou disponibilidade divergem. Endereço da loja e tamanho da embalagem são dados novos (modelo `seller` + metadados/campos nativos de variante).

**Tech Stack:** Medusa v2 (2.15, módulos custom, `query.graph`, workflows core-flows), zod, jest (backend unit), Next.js 15 + zustand + vitest/testing-library (storefront), Medusa admin SDK + @medusajs/ui + vitest (admin), API Melhor Envio v2.

**Spec:** `docs/superpowers/specs/2026-10-15-frete-por-loja-design.md`

## Global Constraints

- Código, identificadores e comentários em inglês; textos de interface em pt-BR.
- Commits Conventional Commits com descrição em português, imperativo, minúsculas, sem ponto final; terminar com as linhas `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01Vvef3QVER5dvioZfAS7L15`.
- Branch `feature/shipping-per-seller` (worktree `/home/lupontes/repos/marketplace-shipping`); nunca commitar em `develop`/`main`.
- Valores monetários sempre em centavos (inteiros); peso em kg, medidas em cm (formato do Melhor Envio e dos campos nativos do Medusa).
- Só Correios: PAC = Econômico (`tier: "economico"`), SEDEX = Rápido (`tier: "rapido"`).
- Limites dos Correios: lado ≤ 100 cm, soma C+L+A ≤ 200 cm, peso ≤ 30 kg.
- Tamanhos padrão: `small` 0,3 kg 16×11×6; `medium` 1 kg 25×20×10; `large` 3 kg 40×30×20; `bulky` medidas informadas.
- Manuseio: `SHIPPING_HANDLING_DAYS` (padrão 2) somado ao maior prazo entre as lojas.
- Tempo limite de 8 s por chamada ao Melhor Envio; cache de 10 min por (CEP origem, CEP destino, itens).
- Cotação falsa só com `NODE_ENV=development` e sem `MELHOR_ENVIO_TOKEN`; fora disso, sem token ⇒ `quote_failed` + log.
- Nunca imprimir ou commitar tokens. Token do sandbox fica só em `infra/.env.oci` no servidor.
- Comandos de teste:
  - backend: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand <path>`
  - admin: `cd packages/medusa-backend/apps/backend && /home/lupontes/repos/marketplace-shipping/apps/storefront/node_modules/.bin/vitest run --config src/admin/vitest.config.ts <path>` (o `pnpm test:admin` está quebrado no develop — vitest 4 × vite 5; usar o binário da storefront)
  - storefront: `cd apps/storefront && npx vitest run <path>`

## Review Focus

1. **CEP do comprador com máscara/espaços ("44300-000 ")** — a cotação e o pagamento devem normalizar para 8 dígitos e cotar igual; teste em Task 5 (`normalizes the destination postal code`) e Task 7 (o CEP do endereço com hífen chega igual ao quote).
2. **Mesmo produto com várias variantes/quantidades da mesma loja** — todas as unidades entram no mesmo pacote daquela loja (uma chamada por loja, `quantity` respeitada); teste em Task 5 (`sends one request per seller with quantities`).
3. **Carrinho persistido no formato antigo (`selectedShipping` com `price`, sem `tier`)** — ao abrir o checkout não pode quebrar nem enviar o formato antigo; teste em Task 10 (`drops a persisted legacy shipping selection`).
4. **Melhor Envio devolve só PAC (SEDEX com `error`) para uma das lojas** — a opção Rápido some inteira e Econômico continua selecionável; teste em Task 5 (`omits a tier when any seller lacks that service`) e Task 10 (só um radio renderizado).
5. **Webhook de pagamento de um checkout criado antes do deploy** (snapshot sem `seller_groups[].shipping`) — pedidos continuam sendo criados com `shippingShare` gravado e nome do frete antigo; teste em Task 7 (`keeps legacy snapshots working`).

---

## File Structure

**Backend (`packages/medusa-backend/apps/backend/src/`)**

| Arquivo | Responsabilidade |
|---|---|
| `utils/package-size.ts` (novo) | Tabela de tamanhos, sugestão por categoria, limites dos Correios, resolução de medidas da variante. Sem imports de framework (admin também importa). |
| `utils/seller-address.ts` (novo) | Schema zod do endereço, `hasShippingOrigin`, normalização de CEP. Sem imports de framework. |
| `modules/seller/models/seller.ts` | +7 campos de endereço. |
| `modules/seller/migrations/Migration20261015120000.ts` (novo) | Colunas de endereço. |
| `api/store/sellers/register/route.ts`, `api/admin/sellers/route.ts`, `api/admin/sellers/[id]/route.ts`, `api/seller/me/route.ts`, `api/admin/sellers/[id]/approve/route.ts` | Endereço obrigatório/editável; aprovação bloqueada sem endereço. |
| `utils/melhor-envio.ts` (novo) | Cliente de cotação (`createMelhorEnvioCalculator`), calculador falso de dev, fábrica `getShippingCalculator`. |
| `utils/shipping-quote.ts` (novo) | Núcleo `quoteShipping` + cache + tipos `ShippingQuote`/`ShippingOption`/`SellerShipping`. |
| `api/store/shipping/quote/route.ts` (novo) | Rota pública de cotação. |
| `api/store/shipping/estimate/` (removido) | Rota antiga. |
| `utils/seller-order-groups.ts` | `shippingShare` = frete real da loja; grupo ganha `shipping`. |
| `utils/checkout-payload.ts` | Schema com `shipping: { tier, expectedTotal }`; `buildCheckoutSnapshot` recebe a opção escolhida. |
| `utils/checkout-shipping.ts` (novo) | `resolveCheckoutShipping`: recotar + 409/422. |
| `api/store/checkout/preference/route.ts`, `api/store/checkout/sandbox-cash/route.ts` | Usam `resolveCheckoutShipping`. |
| `utils/create-orders-from-checkout.ts` | Nome real do frete por loja + metadados `shipping_tier`/`shipping_service_id`. |
| `api/seller/products/route.ts`, `api/seller/products/[id]/route.ts` | `packageSize`/`packageDimensions` → medidas nas variantes + metadados. |
| `api/admin/products/[id]/package-review/route.ts` (novo) | Marcar medidas conferidas. |
| `admin/widgets/product-package-review.tsx` (novo) | Widget no detalhe do produto. |
| `admin/hooks/sellers.ts`, `admin/routes/sellers/[id]/page.tsx` | Seção de endereço editável no detalhe da loja. |

**Storefront (`apps/storefront/src/`)**

| Arquivo | Responsabilidade |
|---|---|
| `lib/cart-store.ts` | `ShippingOption` no lugar de `ShippingRate`; descarte do formato antigo. |
| `app/checkout/shipping-quote.ts` (novo, substitui `shipping-rates.ts`) | Cliente de `/store/shipping/quote`. |
| `app/checkout/create-preference.ts`, `app/checkout/create-test-cash-order.ts` | Enviam `{ tier, expectedTotal }`; tratam 409/422. |
| `app/checkout/ShippingOptions.tsx` (novo) | Opções, nota de vários pacotes, detalhes, indisponíveis. |
| `app/checkout/page.tsx` | Usa o componente e o novo fluxo. |
| `lib/seller-address.ts` (novo) | `hasShippingOrigin` + `fetchAddressByCep` (ViaCEP). |
| `app/painel/perfil/page.tsx`, `app/painel/layout.tsx`, `lib/seller-store.ts` | Seção de endereço + aviso de endereço incompleto. |
| `lib/package-size.ts` (novo) | Espelho da tabela de tamanhos/limites para a UI (o backend valida). |
| `components/product/PackageSizeField.tsx` (novo), `components/product/CategorySelect.tsx` | Campo de tamanho; categoria informa o nome. |
| `app/painel/produtos/novo/page.tsx`, `app/painel/produtos/[id]/page.tsx` | Usam o campo. |

---

### Task 1: Tabela de tamanhos e limites dos Correios (backend)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/package-size.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/package-size.unit.spec.ts`

**Interfaces:**
- Produces:
  - `type PackageSize = "small" | "medium" | "large" | "bulky"`
  - `type PackageDimensions = { weight: number; length: number; width: number; height: number }` (kg, cm)
  - `PACKAGE_SIZES: Record<Exclude<PackageSize,"bulky">, PackageDimensions>`
  - `PACKAGE_SIZE_LABELS: Record<PackageSize, string>`
  - `suggestPackageSize(categoryName?: string | null): PackageSize`
  - `exceedsCorreiosLimits(d: PackageDimensions): boolean`
  - `resolvePackageDimensions(size: PackageSize, custom?: PackageDimensions): PackageDimensions` (lança `Error` se `bulky` sem medidas válidas)
  - `variantDimensionsOrDefault(v: { weight?: number|null; length?: number|null; width?: number|null; height?: number|null }): PackageDimensions`

- [ ] **Step 1: Write the failing test**

```ts
import {
  PACKAGE_SIZES,
  exceedsCorreiosLimits,
  resolvePackageDimensions,
  suggestPackageSize,
  variantDimensionsOrDefault,
} from "../package-size"

describe("package size", () => {
  it("uses the approved default dimensions per size", () => {
    expect(PACKAGE_SIZES.small).toEqual({ weight: 0.3, length: 16, width: 11, height: 6 })
    expect(PACKAGE_SIZES.medium).toEqual({ weight: 1, length: 25, width: 20, height: 10 })
    expect(PACKAGE_SIZES.large).toEqual({ weight: 3, length: 40, width: 30, height: 20 })
  })

  it("suggests a size from the category name, case and accent insensitive, defaulting to medium", () => {
    expect(suggestPackageSize("BRINCOS")).toBe("small")
    expect(suggestPackageSize("Colares")).toBe("small")
    expect(suggestPackageSize("BOLSAS")).toBe("medium")
    expect(suggestPackageSize("KITS PARA BANHEIROS")).toBe("bulky")
    expect(suggestPackageSize("Decoração")).toBe("bulky")
    expect(suggestPackageSize("LUMINÁRIAS")).toBe("bulky")
    expect(suggestPackageSize("SACOLÕES")).toBe("bulky")
    expect(suggestPackageSize("Categoria nova")).toBe("medium")
    expect(suggestPackageSize(undefined)).toBe("medium")
  })

  it("flags dimensions above the Correios limits", () => {
    expect(exceedsCorreiosLimits({ weight: 1, length: 100, width: 50, height: 50 })).toBe(false)
    expect(exceedsCorreiosLimits({ weight: 1, length: 101, width: 10, height: 10 })).toBe(true)
    expect(exceedsCorreiosLimits({ weight: 1, length: 90, width: 60, height: 51 })).toBe(true) // sum 201
    expect(exceedsCorreiosLimits({ weight: 30.1, length: 10, width: 10, height: 10 })).toBe(true)
  })

  it("resolves preset sizes and requires positive custom dimensions for bulky", () => {
    expect(resolvePackageDimensions("small")).toEqual(PACKAGE_SIZES.small)
    const custom = { weight: 1.2, length: 65, width: 40, height: 50 }
    expect(resolvePackageDimensions("bulky", custom)).toEqual(custom)
    expect(() => resolvePackageDimensions("bulky")).toThrow()
    expect(() => resolvePackageDimensions("bulky", { ...custom, height: 0 })).toThrow()
  })

  it("falls back to medium when a variant has missing or zero dimensions", () => {
    expect(variantDimensionsOrDefault({ weight: 0.2, length: 15, width: 15, height: 15 })).toEqual({
      weight: 0.2, length: 15, width: 15, height: 15,
    })
    expect(variantDimensionsOrDefault({ weight: 0, length: 15, width: 15, height: 15 })).toEqual(PACKAGE_SIZES.medium)
    expect(variantDimensionsOrDefault({ weight: 0.2, length: null, width: 15, height: 15 })).toEqual(PACKAGE_SIZES.medium)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand src/utils/__tests__/package-size`
Expected: FAIL with "Cannot find module '../package-size'"

- [ ] **Step 3: Write minimal implementation**

```ts
// Kept free of framework imports: the admin bundle imports this file too.

export type PackageSize = "small" | "medium" | "large" | "bulky"

/** Weight in kg, measures in cm — the units Melhor Envio and Medusa variants use. */
export type PackageDimensions = { weight: number; length: number; width: number; height: number }

export const PACKAGE_SIZES: Record<Exclude<PackageSize, "bulky">, PackageDimensions> = {
  small: { weight: 0.3, length: 16, width: 11, height: 6 },
  medium: { weight: 1, length: 25, width: 20, height: 10 },
  large: { weight: 3, length: 40, width: 30, height: 20 },
}

export const PACKAGE_SIZE_LABELS: Record<PackageSize, string> = {
  small: "Pequeno",
  medium: "Médio",
  large: "Grande",
  bulky: "Volumoso",
}

// Keys are normalized category names (no accents, upper case). Light but
// bulky handicrafts (straw, vine, crochet) are priced by box volume, so they
// start as "bulky" and ask for real measures.
const CATEGORY_SIZE: Record<string, PackageSize> = {
  BRINCOS: "small",
  "BRINCO AFRICANO": "small",
  COLARES: "small",
  PULSEIRAS: "small",
  PINGENTE: "small",
  BOLSAS: "medium",
  "CANECAS, COPOS E GARRAFAS": "medium",
  CHAPEUS: "medium",
  "MODA AFRICANA": "medium",
  "ROUPAS AFRO": "medium",
  "ROUPAS TRADICIONAIS": "medium",
  PETISQUEIRAS: "medium",
  "KITS PARA COZINHA": "bulky",
  "KITS PARA BANHEIROS": "bulky",
  DECORACAO: "bulky",
  LUMINARIAS: "bulky",
  "KIT LUMINARIA": "bulky",
  SACOLOES: "bulky",
}

function normalize(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()
}

export function suggestPackageSize(categoryName?: string | null): PackageSize {
  if (!categoryName) return "medium"
  return CATEGORY_SIZE[normalize(categoryName)] ?? "medium"
}

export const CORREIOS_LIMITS = { maxSide: 100, maxSum: 200, maxWeight: 30 }

export function exceedsCorreiosLimits(d: PackageDimensions): boolean {
  const sides = [d.length, d.width, d.height]
  return (
    Math.max(...sides) > CORREIOS_LIMITS.maxSide ||
    sides.reduce((s, x) => s + x, 0) > CORREIOS_LIMITS.maxSum ||
    d.weight > CORREIOS_LIMITS.maxWeight
  )
}

function isComplete(d: Partial<PackageDimensions> | undefined): d is PackageDimensions {
  return !!d && [d.weight, d.length, d.width, d.height].every((x) => typeof x === "number" && x > 0)
}

export function resolvePackageDimensions(size: PackageSize, custom?: PackageDimensions): PackageDimensions {
  if (size !== "bulky") return PACKAGE_SIZES[size]
  if (!isComplete(custom)) throw new Error("Volumoso exige peso e medidas maiores que zero")
  return custom
}

export function variantDimensionsOrDefault(v: {
  weight?: number | null
  length?: number | null
  width?: number | null
  height?: number | null
}): PackageDimensions {
  const d = { weight: Number(v.weight), length: Number(v.length), width: Number(v.width), height: Number(v.height) }
  return isComplete(d) ? d : PACKAGE_SIZES.medium
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/package-size.ts packages/medusa-backend/apps/backend/src/utils/__tests__/package-size.unit.spec.ts
git commit -m "feat(frete): adicionar tabela de tamanhos de embalagem e limites dos correios"
```

---

### Task 2: Endereço da loja — modelo, migration e validação

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/seller-address.ts`
- Create: `packages/medusa-backend/apps/backend/src/modules/seller/migrations/Migration20261015120000.ts`
- Modify: `packages/medusa-backend/apps/backend/src/modules/seller/models/seller.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/seller-address.unit.spec.ts`

**Interfaces:**
- Produces:
  - Campos do seller: `addressPostalCode`, `addressStreet`, `addressNumber`, `addressComplement`, `addressDistrict`, `addressCity`, `addressState` (todos `text | null`)
  - `sellerAddressSchema` (zod object com esses 7 campos; `addressComplement` opcional; CEP normalizado para 8 dígitos; UF em maiúsculas)
  - `type SellerAddress = z.infer<typeof sellerAddressSchema>`
  - `hasShippingOrigin(seller: Partial<SellerAddress> | null | undefined): boolean`
  - `normalizePostalCode(v: string): string` (só dígitos)

- [ ] **Step 1: Write the failing test**

```ts
import { hasShippingOrigin, normalizePostalCode, sellerAddressSchema } from "../seller-address"

const valid = {
  addressPostalCode: "44300-000",
  addressStreet: "Rua Sete de Setembro",
  addressNumber: "12",
  addressDistrict: "Centro Histórico",
  addressCity: "Cachoeira",
  addressState: "ba",
}

describe("sellerAddressSchema", () => {
  it("normalizes CEP to digits and UF to upper case", () => {
    const parsed = sellerAddressSchema.parse(valid)
    expect(parsed.addressPostalCode).toBe("44300000")
    expect(parsed.addressState).toBe("BA")
    expect(parsed.addressComplement).toBeUndefined()
  })

  it("rejects an invalid CEP, an unknown UF and blank required fields", () => {
    expect(sellerAddressSchema.safeParse({ ...valid, addressPostalCode: "4430" }).success).toBe(false)
    expect(sellerAddressSchema.safeParse({ ...valid, addressState: "XX" }).success).toBe(false)
    expect(sellerAddressSchema.safeParse({ ...valid, addressNumber: "  " }).success).toBe(false)
  })
})

describe("hasShippingOrigin", () => {
  it("requires CEP, street, number, district, city and UF", () => {
    expect(hasShippingOrigin({ ...valid, addressPostalCode: "44300000" })).toBe(true)
    expect(hasShippingOrigin({ ...valid, addressNumber: null as any })).toBe(false)
    expect(hasShippingOrigin({ ...valid, addressPostalCode: "123" })).toBe(false)
    expect(hasShippingOrigin(null)).toBe(false)
  })
})

describe("normalizePostalCode", () => {
  it("keeps only digits", () => {
    expect(normalizePostalCode(" 44.300-000 ")).toBe("44300000")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... npx jest --runInBand src/utils/__tests__/seller-address`
Expected: FAIL with "Cannot find module '../seller-address'"

- [ ] **Step 3: Write implementation**

`utils/seller-address.ts`:

```ts
import { z } from "zod"

// Kept free of framework imports: the admin bundle imports this file too.

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const

export function normalizePostalCode(v: string): string {
  return v.replace(/\D/g, "")
}

const required = (label: string) => z.string().trim().min(1, `${label} obrigatório`)

/** Address of the store's operational base — the origin of every shipment. */
export const sellerAddressSchema = z.object({
  addressPostalCode: z
    .string()
    .transform(normalizePostalCode)
    .refine((v) => v.length === 8, "CEP deve ter 8 dígitos"),
  addressStreet: required("Rua"),
  addressNumber: required("Número"),
  addressComplement: z.string().trim().optional(),
  addressDistrict: required("Bairro"),
  addressCity: required("Cidade"),
  addressState: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => (UFS as readonly string[]).includes(v), "UF inválida"),
})

export type SellerAddress = z.infer<typeof sellerAddressSchema>

export function hasShippingOrigin(seller: Partial<Record<keyof SellerAddress, string | null>> | null | undefined): boolean {
  if (!seller) return false
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0
  return (
    normalizePostalCode(seller.addressPostalCode ?? "").length === 8 &&
    filled(seller.addressStreet) &&
    filled(seller.addressNumber) &&
    filled(seller.addressDistrict) &&
    filled(seller.addressCity) &&
    filled(seller.addressState)
  )
}
```

`modules/seller/models/seller.ts` — acrescentar após `passwordHash`:

```ts
  // Operational base address: origin of every shipment (quotes now, labels in cycle 3).
  // Nullable so existing stores keep working until someone fills it in.
  addressPostalCode: model.text().nullable(),
  addressStreet: model.text().nullable(),
  addressNumber: model.text().nullable(),
  addressComplement: model.text().nullable(),
  addressDistrict: model.text().nullable(),
  addressCity: model.text().nullable(),
  addressState: model.text().nullable(),
```

`modules/seller/migrations/Migration20261015120000.ts`:

```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261015120000 extends Migration {

  override async up(): Promise<void> {
    for (const column of ["addressPostalCode", "addressStreet", "addressNumber", "addressComplement", "addressDistrict", "addressCity", "addressState"]) {
      this.addSql(`alter table if exists "seller" add column if not exists "${column}" text null;`);
    }
  }

  override async down(): Promise<void> {
    for (const column of ["addressPostalCode", "addressStreet", "addressNumber", "addressComplement", "addressDistrict", "addressCity", "addressState"]) {
      this.addSql(`alter table if exists "seller" drop column if exists "${column}";`);
    }
  }

}
```

- [ ] **Step 4: Run tests**

Run: `... npx jest --runInBand src/utils/__tests__/seller-address src/modules/seller`
Expected: PASS (seller module tests continuam passando)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/seller-address.ts packages/medusa-backend/apps/backend/src/utils/__tests__/seller-address.unit.spec.ts packages/medusa-backend/apps/backend/src/modules/seller
git commit -m "feat(lojas): adicionar endereço da base operacional ao cadastro da loja"
```

---

### Task 3: Endereço nas rotas de loja e bloqueio de aprovação

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/sellers/register/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/sellers/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/seller/me/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/approve/route.ts`
- Test: `api/store/sellers/register/__tests__/route.unit.spec.ts` (criar se não existir), `api/seller/me/__tests__/address.unit.spec.ts`, `api/admin/sellers/[id]/approve/__tests__/route.unit.spec.ts` (estender), `api/admin/sellers/[id]/__tests__/address.unit.spec.ts`

**Interfaces:**
- Consumes: `sellerAddressSchema`, `hasShippingOrigin` (Task 2)
- Produces: `PATCH /seller/me` e `PUT /admin/sellers/:id` aceitam os 7 campos de endereço (todos juntos, validados pelo schema completo, quando `addressPostalCode` está presente); `POST /store/sellers/register` e `POST /admin/sellers` exigem endereço; `POST /admin/sellers/:id/approve` responde 400 `{ error: "Preencha o endereço de envio antes de aprovar" }` sem endereço.

- [ ] **Step 1: Write the failing tests**

`api/admin/sellers/[id]/approve/__tests__/route.unit.spec.ts` — acrescentar (reaproveitando os helpers de `makeReq/makeRes` já existentes no arquivo; se não existirem, usar estes):

```ts
import { SELLER_MODULE } from "../../../../../../modules/seller"
import { Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

const address = {
  addressPostalCode: "44300000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
}

function makeReq(seller: Record<string, unknown> | undefined) {
  const sellerService = {
    listSellers: jest.fn().mockResolvedValue(seller ? [seller] : []),
    approveSeller: jest.fn().mockResolvedValue({ id: "s1", status: "approved" }),
  }
  const eventBus = { emit: jest.fn() }
  return {
    params: { id: "s1" },
    scope: { resolve: (k: string) => (k === SELLER_MODULE ? sellerService : k === Modules.EVENT_BUS ? eventBus : undefined) },
    _sellerService: sellerService,
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("POST /admin/sellers/:id/approve — shipping address gate", () => {
  it("refuses to approve a seller without a complete shipping address", async () => {
    const req = makeReq({ id: "s1", status: "pending" })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe("Preencha o endereço de envio antes de aprovar")
    expect(req._sellerService.approveSeller).not.toHaveBeenCalled()
  })

  it("approves a seller with a complete address", async () => {
    const req = makeReq({ id: "s1", status: "pending", ...address })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(200)
    expect(req._sellerService.approveSeller).toHaveBeenCalledWith("s1")
  })
})
```

`api/seller/me/__tests__/address.unit.spec.ts`:

```ts
import { SELLER_MODULE } from "../../../../modules/seller"
import { PATCH } from "../route"

function makeReq(body: unknown) {
  const sellerService = { updateSellers: jest.fn(async ({ data }: any) => [{ id: "s1", ...data, passwordHash: "x" }]) }
  return { body, sellerId: "s1", scope: { resolve: (k: string) => (k === SELLER_MODULE ? sellerService : undefined) }, _svc: sellerService } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}
const address = {
  addressPostalCode: "44300-000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "ba",
}

describe("PATCH /seller/me — address", () => {
  it("saves a normalized address", async () => {
    const req = makeReq(address)
    const res = makeRes()
    await PATCH(req, res)
    expect(res._status).toBe(200)
    expect(req._svc.updateSellers).toHaveBeenCalledWith({
      selector: { id: "s1" },
      data: expect.objectContaining({ addressPostalCode: "44300000", addressState: "BA" }),
    })
    expect(res._body.seller.passwordHash).toBeUndefined()
  })

  it("rejects a partial address", async () => {
    const res = makeRes()
    await PATCH(makeReq({ addressPostalCode: "44300000" }), res)
    expect(res._status).toBe(400)
  })

  it("still accepts profile updates without address fields", async () => {
    const req = makeReq({ bio: "Olá" })
    const res = makeRes()
    await PATCH(req, res)
    expect(res._status).toBe(200)
    expect(req._svc.updateSellers.mock.calls[0][0].data).toEqual({ bio: "Olá" })
  })
})
```

`api/store/sellers/register/__tests__/route.unit.spec.ts`:

```ts
import { SELLER_MODULE } from "../../../../../modules/seller"
import { POST } from "../route"

const base = {
  name: "Loja X", ownerName: "Ana", email: "ana@x.com", phone: "71999990000", cpfCnpj: "11144477735",
}
const address = {
  addressPostalCode: "40026010", addressStreet: "Largo Terreiro de Jesus", addressNumber: "10",
  addressDistrict: "Centro Histórico", addressCity: "Salvador", addressState: "BA",
}
function makeReq(body: unknown) {
  const sellerService = {
    listSellers: jest.fn().mockResolvedValue([]),
    createSellers: jest.fn(async (d: any) => ({ id: "s1", ...d })),
  }
  return { body, scope: { resolve: (k: string) => (k === SELLER_MODULE ? sellerService : undefined) }, _svc: sellerService } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("POST /store/sellers/register — address", () => {
  it("requires the shipping address", async () => {
    const res = makeRes()
    await POST(makeReq(base), res)
    expect(res._status).toBe(400)
  })

  it("stores the address with the new seller", async () => {
    const req = makeReq({ ...base, ...address })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(201)
    expect(req._svc.createSellers).toHaveBeenCalledWith(expect.objectContaining({ addressPostalCode: "40026010", status: "pending" }))
  })
})
```

`api/admin/sellers/[id]/__tests__/address.unit.spec.ts`:

```ts
import { SELLER_MODULE } from "../../../../../modules/seller"
import { PUT } from "../route"

function makeReq(body: unknown) {
  const sellerService = { updateSellers: jest.fn(async ({ data }: any) => [{ id: "s1", ...data }]) }
  return { body, params: { id: "s1" }, scope: { resolve: (k: string) => (k === SELLER_MODULE ? sellerService : undefined) }, _svc: sellerService } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("PUT /admin/sellers/:id — address", () => {
  it("lets the team fill in a seller's address", async () => {
    const req = makeReq({
      addressPostalCode: "44300-000", addressStreet: "Rua A", addressNumber: "1",
      addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
    })
    const res = makeRes()
    await PUT(req, res)
    expect(res._status).toBe(200)
    expect(req._svc.updateSellers.mock.calls[0][0].data.addressPostalCode).toBe("44300000")
  })

  it("rejects a partial address", async () => {
    const res = makeRes()
    await PUT(makeReq({ addressCity: "Cachoeira" }), res)
    expect(res._status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `... npx jest --runInBand src/api/store/sellers src/api/seller/me src/api/admin/sellers`
Expected: FAIL (approve aprova sem endereço; schemas não conhecem os campos)

- [ ] **Step 3: Implement**

Em cada uma das quatro rotas de escrita, a regra é a mesma: o endereço é um bloco — se qualquer campo de endereço vier no corpo, o bloco inteiro é validado por `sellerAddressSchema`. Criar um helper no próprio `utils/seller-address.ts`:

```ts
const ADDRESS_KEYS = [
  "addressPostalCode", "addressStreet", "addressNumber", "addressComplement",
  "addressDistrict", "addressCity", "addressState",
] as const

/**
 * Splits a request body into its address block and the rest. The address is
 * all-or-nothing: if any address key is present the whole block must be valid.
 * Returns `address: undefined` when no address key was sent.
 */
export function parseAddressBlock(
  body: Record<string, unknown>
): { ok: true; address?: SellerAddress; rest: Record<string, unknown> } | { ok: false; error: z.ZodError } {
  const rest: Record<string, unknown> = {}
  const raw: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body ?? {})) {
    if ((ADDRESS_KEYS as readonly string[]).includes(k)) raw[k] = v
    else rest[k] = v
  }
  if (Object.keys(raw).length === 0) return { ok: true, rest }
  const parsed = sellerAddressSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error }
  return { ok: true, address: parsed.data, rest }
}
```

`api/seller/me/route.ts` — `PATCH`:

```ts
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const sellerId = (req as any).sellerId

  const block = parseAddressBlock((req.body ?? {}) as Record<string, unknown>)
  if (!block.ok) {
    return res.status(400).json({ error: "Endereço inválido", details: block.error.flatten() })
  }
  const parsed = UpdateProfileSchema.safeParse(block.rest)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const [seller] = await sellerService.updateSellers({
    selector: { id: sellerId },
    data: { ...parsed.data, ...(block.address ?? {}) },
  })

  const { passwordHash, ...safe } = seller as any
  res.json({ seller: safe })
}
```

`api/admin/sellers/[id]/route.ts` — `PUT`: mesmo padrão (`parseAddressBlock` → `UpdateSellerSchema.safeParse(block.rest)` → `data: { ...parsed.data, ...(block.address ?? {}) }`).

`api/store/sellers/register/route.ts` e `api/admin/sellers/route.ts` (`POST`): trocar o schema por `RegisterSchema.merge(sellerAddressSchema)` / `CreateSellerSchema.merge(sellerAddressSchema)` — o endereço passa a ser obrigatório e já sai normalizado em `parsed.data`.

`api/admin/sellers/[id]/approve/route.ts` — antes de `approveSeller`:

```ts
  if (!hasShippingOrigin(existing as any)) {
    return res.status(400).json({ error: "Preencha o endereço de envio antes de aprovar" })
  }
```

- [ ] **Step 4: Run tests**

Run: `... npx jest --runInBand src/api/store/sellers src/api/seller src/api/admin/sellers src/utils/__tests__/seller-address`
Expected: PASS. Se testes antigos de register/admin create enviarem corpos sem endereço, acrescentar o bloco `address` neles (é a nova regra).

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api packages/medusa-backend/apps/backend/src/utils/seller-address.ts
git commit -m "feat(lojas): exigir endereço de envio no cadastro e na aprovação da loja"
```

---

### Task 4: Cliente de cotação do Melhor Envio

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/melhor-envio.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/melhor-envio.unit.spec.ts`

**Interfaces:**
- Produces:
  - `type QuoteProduct = { id: string; weight: number; length: number; width: number; height: number; insuranceValue: number; quantity: number }` (insuranceValue em centavos)
  - `type ServiceQuote = { service: "PAC" | "SEDEX"; serviceId: number; price: number; deliveryDays: number }` (price em centavos)
  - `type ShippingCalculator = (input: { fromPostalCode: string; toPostalCode: string; products: QuoteProduct[] }) => Promise<ServiceQuote[]>`
  - `createMelhorEnvioCalculator(opts: { token: string; sandbox: boolean; timeoutMs?: number; fetchImpl?: typeof fetch }): ShippingCalculator`
  - `mockShippingCalculator: ShippingCalculator`
  - `getShippingCalculator(env?: NodeJS.ProcessEnv): ShippingCalculator | null`

- [ ] **Step 1: Write the failing test**

```ts
import { createMelhorEnvioCalculator, getShippingCalculator, mockShippingCalculator } from "../melhor-envio"

const input = {
  fromPostalCode: "44300000",
  toPostalCode: "01310100",
  products: [{ id: "var-1", weight: 0.5, length: 20, width: 15, height: 10, insuranceValue: 7700, quantity: 2 }],
}

function okFetch(body: unknown) {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
}

describe("createMelhorEnvioCalculator", () => {
  it("posts products in Melhor Envio units, only Correios PAC and SEDEX, to the sandbox host", async () => {
    const fetchImpl = okFetch([])
    await createMelhorEnvioCalculator({ token: "tok", sandbox: true, fetchImpl })(input)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate")
    expect(init.headers.Authorization).toBe("Bearer tok")
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      from: { postal_code: "44300000" },
      to: { postal_code: "01310100" },
      products: [{ id: "var-1", weight: 0.5, length: 20, width: 15, height: 10, insurance_value: 77, quantity: 2 }],
      services: "1,2",
    })
  })

  it("uses the production host outside sandbox", async () => {
    const fetchImpl = okFetch([])
    await createMelhorEnvioCalculator({ token: "tok", sandbox: false, fetchImpl })(input)
    expect(fetchImpl.mock.calls[0][0]).toBe("https://melhorenvio.com.br/api/v2/me/shipment/calculate")
  })

  it("maps PAC and SEDEX to cents and days, ignoring errored and non-Correios services", async () => {
    const fetchImpl = okFetch([
      { id: 1, name: "PAC", price: "36.79", custom_price: "36.79", delivery_time: 9, custom_delivery_time: 10, company: { name: "Correios" } },
      { id: 2, name: "SEDEX", error: "Serviço indisponível", company: { name: "Correios" } },
      { id: 3, name: ".Package", price: "27.19", delivery_time: 5, company: { name: "Jadlog" } },
    ])
    const quotes = await createMelhorEnvioCalculator({ token: "tok", sandbox: true, fetchImpl })(input)
    expect(quotes).toEqual([{ service: "PAC", serviceId: 1, price: 3679, deliveryDays: 10 }])
  })

  it("throws on HTTP errors so the caller marks the seller as quote_failed", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthenticated." }) })
    await expect(createMelhorEnvioCalculator({ token: "bad", sandbox: true, fetchImpl })(input)).rejects.toThrow("401")
  })

  it("aborts after the timeout", async () => {
    const fetchImpl = jest.fn((_url: string, init: any) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))
    )
    await expect(
      createMelhorEnvioCalculator({ token: "tok", sandbox: true, timeoutMs: 10, fetchImpl: fetchImpl as any })(input)
    ).rejects.toThrow()
  })
})

describe("getShippingCalculator", () => {
  it("returns a real calculator when a token is set", () => {
    expect(getShippingCalculator({ MELHOR_ENVIO_TOKEN: "tok", NODE_ENV: "production" } as any)).toEqual(expect.any(Function))
  })
  it("returns the mock only in development without a token", () => {
    expect(getShippingCalculator({ NODE_ENV: "development" } as any)).toBe(mockShippingCalculator)
  })
  it("returns null without a token outside development", () => {
    expect(getShippingCalculator({ NODE_ENV: "production" } as any)).toBeNull()
  })
})

describe("mockShippingCalculator", () => {
  it("returns PAC and SEDEX deterministically", async () => {
    const quotes = await mockShippingCalculator(input)
    expect(quotes.map((q) => q.service)).toEqual(["PAC", "SEDEX"])
    expect(quotes[0].price).toBeLessThan(quotes[1].price)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... npx jest --runInBand src/utils/__tests__/melhor-envio`
Expected: FAIL with "Cannot find module '../melhor-envio'"

- [ ] **Step 3: Write implementation**

```ts
export type QuoteProduct = {
  id: string
  weight: number
  length: number
  width: number
  height: number
  /** Declared value in cents, used by Melhor Envio for the insurance. */
  insuranceValue: number
  quantity: number
}

export type ServiceQuote = { service: "PAC" | "SEDEX"; serviceId: number; price: number; deliveryDays: number }

export type ShippingCalculator = (input: {
  fromPostalCode: string
  toPostalCode: string
  products: QuoteProduct[]
}) => Promise<ServiceQuote[]>

// Melhor Envio service ids for Correios. Only Correios is offered: it has an
// agency in nearly every town, which matters for first-time sellers.
const CORREIOS_SERVICES = "1,2"

export function createMelhorEnvioCalculator(opts: {
  token: string
  sandbox: boolean
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): ShippingCalculator {
  const baseUrl = opts.sandbox ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br"
  const doFetch = opts.fetchImpl ?? fetch

  return async ({ fromPostalCode, toPostalCode, products }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
    try {
      const res = await doFetch(`${baseUrl}/api/v2/me/shipment/calculate`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mercado Preto (contato@mercadopreto.com.br)",
        },
        body: JSON.stringify({
          from: { postal_code: fromPostalCode },
          to: { postal_code: toPostalCode },
          products: products.map((p) => ({
            id: p.id,
            weight: p.weight,
            length: p.length,
            width: p.width,
            height: p.height,
            insurance_value: p.insuranceValue / 100,
            quantity: p.quantity,
          })),
          services: CORREIOS_SERVICES,
        }),
      })
      if (!res.ok) throw new Error(`Melhor Envio respondeu ${res.status}`)
      const data = (await res.json()) as any[]
      return (Array.isArray(data) ? data : [])
        .filter((s) => !s.error && s.company?.name === "Correios" && (s.name === "PAC" || s.name === "SEDEX"))
        .map((s) => ({
          service: s.name as "PAC" | "SEDEX",
          serviceId: Number(s.id),
          price: Math.round(Number(s.custom_price ?? s.price) * 100),
          deliveryDays: Number(s.custom_delivery_time ?? s.delivery_time),
        }))
        .filter((q) => Number.isFinite(q.price) && q.price > 0)
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Deterministic quotes for local development without a Melhor Envio token. */
export const mockShippingCalculator: ShippingCalculator = async ({ products }) => {
  const weight = products.reduce((s, p) => s + p.weight * p.quantity, 0)
  const pac = 2490 + Math.round(weight * 500)
  return [
    { service: "PAC", serviceId: 1, price: pac, deliveryDays: 9 },
    { service: "SEDEX", serviceId: 2, price: pac * 2, deliveryDays: 4 },
  ]
}

export function getShippingCalculator(env: NodeJS.ProcessEnv = process.env): ShippingCalculator | null {
  if (env.MELHOR_ENVIO_TOKEN) {
    return createMelhorEnvioCalculator({
      token: env.MELHOR_ENVIO_TOKEN,
      sandbox: env.MARKETPLACE_SANDBOX !== "false",
    })
  }
  return env.NODE_ENV === "development" ? mockShippingCalculator : null
}
```

Observação para o implementador: `sandbox: env.MARKETPLACE_SANDBOX !== "false"` replica `isSandboxMode()` (`utils/sandbox.ts`) sem ler `process.env` global, para o teste conseguir injetar o ambiente.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/melhor-envio.ts packages/medusa-backend/apps/backend/src/utils/__tests__/melhor-envio.unit.spec.ts
git commit -m "feat(frete): adicionar cliente de cotação do melhor envio"
```

---

### Task 5: Núcleo da cotação por loja (`quoteShipping`)

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/shipping-quote.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/shipping-quote.unit.spec.ts`

**Interfaces:**
- Consumes: `ShippingCalculator`, `QuoteProduct`, `ServiceQuote` (Task 4); `variantDimensionsOrDefault`, `exceedsCorreiosLimits` (Task 1); `hasShippingOrigin`, `normalizePostalCode` (Task 2)
- Produces:
  - `type ShippingTier = "economico" | "rapido"`
  - `type SellerShipping = { sellerId: string; sellerName: string; tier: ShippingTier; service: "PAC" | "SEDEX"; serviceId: number; price: number; deliveryDays: number }`
  - `type ShippingOption = { tier: ShippingTier; label: string; total: number; deliveryDays: number; sellers: SellerShipping[] }`
  - `type UnavailableSeller = { sellerId: string; sellerName: string; reason: "missing_address" | "oversized" | "quote_failed"; productTitles: string[] }`
  - `type ShippingQuote = { options: ShippingOption[]; unavailableSellers: UnavailableSeller[] }`
  - `type QuoteItemInput = { variantId: string; quantity: number }`
  - `quoteShipping(deps: { query: { graph: (args: any) => Promise<{ data: any[] }> }; calculator: ShippingCalculator | null; cache?: QuoteCache; handlingDays?: number; logger?: { error: (m: string) => void } }, input: { postalCode: string; items: QuoteItemInput[] }): Promise<ShippingQuote>`
  - `class QuoteCache { constructor(ttlMs?: number, now?: () => number); get(key: string): ServiceQuote[] | undefined; set(key: string, value: ServiceQuote[]): void }`
  - `defaultQuoteCache: QuoteCache` (instância de módulo, TTL 10 min)
  - `handlingDaysFromEnv(env?: NodeJS.ProcessEnv): number` (padrão 2)

- [ ] **Step 1: Write the failing test**

```ts
import { QuoteCache, quoteShipping } from "../shipping-quote"
import type { ServiceQuote } from "../melhor-envio"

const addressA = {
  addressPostalCode: "44300000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
}
const addressB = { ...addressA, addressPostalCode: "40026010", addressCity: "Salvador" }

// Two graph calls: variants first, then products with their seller.
function makeQuery(opts: { variants: any[]; products: any[] }) {
  return {
    graph: jest.fn(async ({ entity }: any) => ({ data: entity === "product_variant" ? opts.variants : opts.products })),
  }
}

const variants = [
  { id: "var-a1", product_id: "prod-a", weight: 0.2, length: 15, width: 15, height: 15, prices: [{ amount: 7700, currency_code: "brl" }] },
  { id: "var-a2", product_id: "prod-a", weight: 0, length: 0, width: 0, height: 0, prices: [{ amount: 5000, currency_code: "brl" }] },
  { id: "var-b1", product_id: "prod-b", weight: 1, length: 30, width: 20, height: 10, prices: [{ amount: 12000, currency_code: "brl" }] },
]
const products = [
  { id: "prod-a", title: "Colar", seller: { id: "seller-a", name: "Loja A", ...addressA } },
  { id: "prod-b", title: "Bolsa", seller: { id: "seller-b", name: "Loja B", ...addressB } },
]

const quotesByOrigin: Record<string, ServiceQuote[]> = {
  "44300000": [
    { service: "PAC", serviceId: 1, price: 3000, deliveryDays: 9 },
    { service: "SEDEX", serviceId: 2, price: 6000, deliveryDays: 4 },
  ],
  "40026010": [
    { service: "PAC", serviceId: 1, price: 2000, deliveryDays: 7 },
    { service: "SEDEX", serviceId: 2, price: 5000, deliveryDays: 3 },
  ],
}

function makeCalculator(overrides: Record<string, ServiceQuote[] | Error> = {}) {
  return jest.fn(async ({ fromPostalCode }: any) => {
    const v = overrides[fromPostalCode] ?? quotesByOrigin[fromPostalCode]
    if (v instanceof Error) throw v
    return v
  })
}

const items = [
  { variantId: "var-a1", quantity: 2 },
  { variantId: "var-a2", quantity: 1 },
  { variantId: "var-b1", quantity: 1 },
]

describe("quoteShipping", () => {
  it("sums PAC into Econômico and SEDEX into Rápido, with the slowest seller plus handling days", async () => {
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products }), calculator: makeCalculator(), cache: new QuoteCache(), handlingDays: 2 },
      { postalCode: "01310100", items }
    )

    expect(quote.unavailableSellers).toEqual([])
    expect(quote.options).toEqual([
      expect.objectContaining({ tier: "economico", label: "Econômico", total: 5000, deliveryDays: 11 }),
      expect.objectContaining({ tier: "rapido", label: "Rápido", total: 11000, deliveryDays: 6 }),
    ])
    expect(quote.options[0].sellers).toEqual([
      { sellerId: "seller-a", sellerName: "Loja A", tier: "economico", service: "PAC", serviceId: 1, price: 3000, deliveryDays: 9 },
      { sellerId: "seller-b", sellerName: "Loja B", tier: "economico", service: "PAC", serviceId: 1, price: 2000, deliveryDays: 7 },
    ])
  })

  it("sends one request per seller with quantities, real dimensions, medium fallback and declared value", async () => {
    const calculator = makeCalculator()
    await quoteShipping(
      { query: makeQuery({ variants, products }), calculator, cache: new QuoteCache() },
      { postalCode: "01310100", items }
    )

    expect(calculator).toHaveBeenCalledTimes(2)
    expect(calculator).toHaveBeenCalledWith({
      fromPostalCode: "44300000",
      toPostalCode: "01310100",
      products: [
        { id: "var-a1", weight: 0.2, length: 15, width: 15, height: 15, insuranceValue: 7700, quantity: 2 },
        { id: "var-a2", weight: 1, length: 25, width: 20, height: 10, insuranceValue: 5000, quantity: 1 },
      ],
    })
  })

  it("normalizes the destination postal code", async () => {
    const calculator = makeCalculator()
    await quoteShipping(
      { query: makeQuery({ variants, products }), calculator, cache: new QuoteCache() },
      { postalCode: " 01310-100 ", items }
    )
    expect(calculator.mock.calls[0][0].toPostalCode).toBe("01310100")
  })

  it("marks a seller without a complete address as missing_address and does not quote it", async () => {
    const noAddress = [products[0], { ...products[1], seller: { id: "seller-b", name: "Loja B" } }]
    const calculator = makeCalculator()
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products: noAddress }), calculator, cache: new QuoteCache() },
      { postalCode: "01310100", items }
    )
    expect(quote.unavailableSellers).toEqual([
      { sellerId: "seller-b", sellerName: "Loja B", reason: "missing_address", productTitles: ["Bolsa"] },
    ])
    expect(calculator).toHaveBeenCalledTimes(1)
  })

  it("marks a seller with an item above the Correios limits as oversized", async () => {
    const big = variants.map((v) => (v.id === "var-b1" ? { ...v, length: 120 } : v))
    const quote = await quoteShipping(
      { query: makeQuery({ variants: big, products }), calculator: makeCalculator(), cache: new QuoteCache() },
      { postalCode: "01310100", items }
    )
    expect(quote.unavailableSellers[0]).toEqual(expect.objectContaining({ sellerId: "seller-b", reason: "oversized" }))
  })

  it("marks a seller as quote_failed when Melhor Envio errors or returns no Correios service", async () => {
    const logger = { error: jest.fn() }
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products }), calculator: makeCalculator({ "40026010": new Error("timeout") }), cache: new QuoteCache(), logger },
      { postalCode: "01310100", items }
    )
    expect(quote.unavailableSellers).toEqual([expect.objectContaining({ sellerId: "seller-b", reason: "quote_failed" })])
    expect(logger.error).toHaveBeenCalled()
  })

  it("marks every seller as quote_failed when no calculator is configured", async () => {
    const quote = await quoteShipping(
      { query: makeQuery({ variants, products }), calculator: null, cache: new QuoteCache(), logger: { error: jest.fn() } },
      { postalCode: "01310100", items }
    )
    expect(quote.options).toEqual([])
    expect(quote.unavailableSellers.map((u) => u.reason)).toEqual(["quote_failed", "quote_failed"])
  })

  it("omits a tier when any seller lacks that service", async () => {
    const quote = await quoteShipping(
      {
        query: makeQuery({ variants, products }),
        calculator: makeCalculator({ "40026010": [{ service: "PAC", serviceId: 1, price: 2000, deliveryDays: 7 }] }),
        cache: new QuoteCache(),
      },
      { postalCode: "01310100", items }
    )
    expect(quote.options.map((o) => o.tier)).toEqual(["economico"])
  })

  it("serves repeated quotes from the cache until the TTL expires", async () => {
    let now = 0
    const cache = new QuoteCache(10 * 60 * 1000, () => now)
    const calculator = makeCalculator()
    const deps = { query: makeQuery({ variants, products }), calculator, cache }
    await quoteShipping(deps, { postalCode: "01310100", items })
    await quoteShipping(deps, { postalCode: "01310100", items })
    expect(calculator).toHaveBeenCalledTimes(2) // two sellers, first call only
    now = 10 * 60 * 1000 + 1
    await quoteShipping(deps, { postalCode: "01310100", items })
    expect(calculator).toHaveBeenCalledTimes(4)
  })

  it("throws for a variant that does not exist", async () => {
    await expect(
      quoteShipping(
        { query: makeQuery({ variants, products }), calculator: makeCalculator(), cache: new QuoteCache() },
        { postalCode: "01310100", items: [{ variantId: "nope", quantity: 1 }] }
      )
    ).rejects.toThrow("nope")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... npx jest --runInBand src/utils/__tests__/shipping-quote`
Expected: FAIL with "Cannot find module '../shipping-quote'"

- [ ] **Step 3: Write implementation**

```ts
import type { QuoteProduct, ServiceQuote, ShippingCalculator } from "./melhor-envio"
import { exceedsCorreiosLimits, variantDimensionsOrDefault } from "./package-size"
import { hasShippingOrigin, normalizePostalCode } from "./seller-address"

export type ShippingTier = "economico" | "rapido"

export type SellerShipping = {
  sellerId: string
  sellerName: string
  tier: ShippingTier
  service: "PAC" | "SEDEX"
  serviceId: number
  price: number
  deliveryDays: number
}

export type ShippingOption = {
  tier: ShippingTier
  label: string
  total: number
  deliveryDays: number
  sellers: SellerShipping[]
}

export type UnavailableSeller = {
  sellerId: string
  sellerName: string
  reason: "missing_address" | "oversized" | "quote_failed"
  productTitles: string[]
}

export type ShippingQuote = { options: ShippingOption[]; unavailableSellers: UnavailableSeller[] }

export type QuoteItemInput = { variantId: string; quantity: number }

const TIERS: Array<{ tier: ShippingTier; label: string; service: "PAC" | "SEDEX" }> = [
  { tier: "economico", label: "Econômico", service: "PAC" },
  { tier: "rapido", label: "Rápido", service: "SEDEX" },
]

export class QuoteCache {
  private entries = new Map<string, { value: ServiceQuote[]; expiresAt: number }>()
  constructor(private ttlMs = 10 * 60 * 1000, private now: () => number = Date.now) {}
  get(key: string): ServiceQuote[] | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    if (hit.expiresAt < this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return hit.value
  }
  set(key: string, value: ServiceQuote[]): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }
}

// Shared by the quote route and checkout so the payment step usually finds
// the exact price the buyer was shown.
export const defaultQuoteCache = new QuoteCache()

export function handlingDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SHIPPING_HANDLING_DAYS)
  return Number.isInteger(n) && n >= 0 ? n : 2
}

type SellerBucket = {
  sellerId: string
  sellerName: string
  seller: Record<string, any>
  products: QuoteProduct[]
  titles: string[]
  oversized: boolean
}

function brlPrice(prices: Array<{ amount: number; currency_code: string }> | undefined): number {
  return Number(prices?.find((p) => p.currency_code === "brl")?.amount ?? 0)
}

export async function quoteShipping(
  deps: {
    query: { graph: (args: any) => Promise<{ data: any[] }> }
    calculator: ShippingCalculator | null
    cache?: QuoteCache
    handlingDays?: number
    logger?: { error: (m: string) => void }
  },
  input: { postalCode: string; items: QuoteItemInput[] }
): Promise<ShippingQuote> {
  const cache = deps.cache ?? defaultQuoteCache
  const handlingDays = deps.handlingDays ?? handlingDaysFromEnv()
  const toPostalCode = normalizePostalCode(input.postalCode)

  const { data: variants } = await deps.query.graph({
    entity: "product_variant",
    fields: ["id", "product_id", "weight", "length", "width", "height", "prices.amount", "prices.currency_code"],
    filters: { id: input.items.map((i) => i.variantId) },
  })
  const variantById = new Map(variants.map((v: any) => [v.id, v]))
  for (const item of input.items) {
    if (!variantById.has(item.variantId)) throw new Error(`Variante não encontrada: ${item.variantId}`)
  }

  // Same product → seller resolution buildCheckoutSnapshot already relies on.
  const productIds = [...new Set(variants.map((v: any) => v.product_id))]
  const { data: products } = await deps.query.graph({
    entity: "product",
    fields: [
      "id", "title", "seller.id", "seller.name",
      "seller.addressPostalCode", "seller.addressStreet", "seller.addressNumber",
      "seller.addressDistrict", "seller.addressCity", "seller.addressState",
    ],
    filters: { id: productIds },
  })
  const productById = new Map(products.map((p: any) => [p.id, p]))

  const buckets = new Map<string, SellerBucket>()
  for (const item of input.items) {
    const variant: any = variantById.get(item.variantId)
    const product: any = productById.get(variant.product_id)
    if (!product?.seller?.id) throw new Error(`Produto sem vendedor: ${variant.product_id}`)
    const sellerId = product.seller.id
    if (!buckets.has(sellerId)) {
      buckets.set(sellerId, { sellerId, sellerName: product.seller.name, seller: product.seller, products: [], titles: [], oversized: false })
    }
    const bucket = buckets.get(sellerId)!
    const dims = variantDimensionsOrDefault(variant)
    if (exceedsCorreiosLimits(dims)) bucket.oversized = true
    if (!bucket.titles.includes(product.title)) bucket.titles.push(product.title)
    bucket.products.push({ id: variant.id, ...dims, insuranceValue: brlPrice(variant.prices), quantity: item.quantity })
  }

  const unavailableSellers: UnavailableSeller[] = []
  const quotedSellers: Array<{ bucket: SellerBucket; quotes: ServiceQuote[] }> = []

  const unavailable = (bucket: SellerBucket, reason: UnavailableSeller["reason"]) =>
    unavailableSellers.push({ sellerId: bucket.sellerId, sellerName: bucket.sellerName, reason, productTitles: bucket.titles })

  await Promise.all(
    [...buckets.values()].map(async (bucket) => {
      if (!hasShippingOrigin(bucket.seller)) return unavailable(bucket, "missing_address")
      if (bucket.oversized) return unavailable(bucket, "oversized")
      if (!deps.calculator) {
        deps.logger?.error("[shipping-quote] MELHOR_ENVIO_TOKEN ausente — cotação indisponível")
        return unavailable(bucket, "quote_failed")
      }
      const fromPostalCode = normalizePostalCode(bucket.seller.addressPostalCode)
      const key = JSON.stringify([fromPostalCode, toPostalCode, bucket.products])
      try {
        let quotes = cache.get(key)
        if (!quotes) {
          quotes = await deps.calculator({ fromPostalCode, toPostalCode, products: bucket.products })
          cache.set(key, quotes)
        }
        if (quotes.length === 0) return unavailable(bucket, "quote_failed")
        quotedSellers.push({ bucket, quotes })
      } catch (err) {
        deps.logger?.error(`[shipping-quote] falha ao cotar loja ${bucket.sellerId}: ${err instanceof Error ? err.message : err}`)
        unavailable(bucket, "quote_failed")
      }
    })
  )

  // Keep cart order for a stable UI and deterministic snapshots.
  const order = [...buckets.keys()]
  quotedSellers.sort((a, b) => order.indexOf(a.bucket.sellerId) - order.indexOf(b.bucket.sellerId))
  unavailableSellers.sort((a, b) => order.indexOf(a.sellerId) - order.indexOf(b.sellerId))

  const options: ShippingOption[] = []
  if (quotedSellers.length > 0) {
    for (const { tier, label, service } of TIERS) {
      const sellers: SellerShipping[] = []
      for (const { bucket, quotes } of quotedSellers) {
        const q = quotes.find((x) => x.service === service)
        if (!q) break
        sellers.push({ sellerId: bucket.sellerId, sellerName: bucket.sellerName, tier, ...q })
      }
      if (sellers.length !== quotedSellers.length) continue
      options.push({
        tier,
        label,
        total: sellers.reduce((s, x) => s + x.price, 0),
        deliveryDays: Math.max(...sellers.map((x) => x.deliveryDays)) + handlingDays,
        sellers,
      })
    }
  }

  return { options, unavailableSellers }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/utils/shipping-quote.ts packages/medusa-backend/apps/backend/src/utils/__tests__/shipping-quote.unit.spec.ts
git commit -m "feat(frete): cotar frete por loja com opções econômico e rápido"
```

---

### Task 6: Rota `POST /store/shipping/quote` e remoção da rota antiga

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/store/shipping/quote/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/shipping/quote/__tests__/route.unit.spec.ts`
- Delete: `packages/medusa-backend/apps/backend/src/api/store/shipping/estimate/` (rota + teste)
- Modify: `infra/docker-compose.oci.yml`, `infra/docker-compose.prod.yml`, `packages/medusa-backend/apps/backend/.env.template`, `docs/DEPLOY_OCI.md` (remover `MELHOR_ENVIO_ORIGIN_CEP`; documentar `SHIPPING_HANDLING_DAYS` opcional e que `MELHOR_ENVIO_TOKEN` no servidor de teste é o do **sandbox**)

**Interfaces:**
- Consumes: `quoteShipping`, `defaultQuoteCache` (Task 5), `getShippingCalculator` (Task 4)
- Produces: `POST /store/shipping/quote` com corpo `{ postalCode: string; items: Array<{ variantId: string; quantity: number }> }` → `200 ShippingQuote`; `400 { error }` para CEP inválido, itens vazios ou variante inexistente.

- [ ] **Step 1: Write the failing test**

```ts
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("../../../../../utils/shipping-quote", () => ({
  quoteShipping: jest.fn(),
  defaultQuoteCache: {},
}))
jest.mock("../../../../../utils/melhor-envio", () => ({ getShippingCalculator: jest.fn(() => "calculator") }))

import { quoteShipping } from "../../../../../utils/shipping-quote"
import { POST } from "../route"

function makeReq(body: unknown) {
  const logger = { error: jest.fn() }
  return {
    body,
    scope: { resolve: (k: string) => (k === ContainerRegistrationKeys.QUERY ? { graph: jest.fn() } : k === "logger" ? logger : undefined) },
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("POST /store/shipping/quote", () => {
  beforeEach(() => (quoteShipping as jest.Mock).mockReset())

  it("returns the quote for valid input", async () => {
    ;(quoteShipping as jest.Mock).mockResolvedValue({ options: [], unavailableSellers: [] })
    const res = makeRes()
    await POST(makeReq({ postalCode: "01310-100", items: [{ variantId: "v1", quantity: 2 }] }), res)
    expect(res._status).toBe(200)
    expect(res._body).toEqual({ options: [], unavailableSellers: [] })
    expect((quoteShipping as jest.Mock).mock.calls[0][1]).toEqual({ postalCode: "01310-100", items: [{ variantId: "v1", quantity: 2 }] })
    expect((quoteShipping as jest.Mock).mock.calls[0][0].calculator).toBe("calculator")
  })

  it("rejects an invalid postal code or empty cart with 400", async () => {
    for (const body of [
      { postalCode: "123", items: [{ variantId: "v1", quantity: 1 }] },
      { postalCode: "01310100", items: [] },
      { postalCode: "01310100", items: [{ variantId: "v1", quantity: 0 }] },
    ]) {
      const res = makeRes()
      await POST(makeReq(body), res)
      expect(res._status).toBe(400)
    }
    expect(quoteShipping).not.toHaveBeenCalled()
  })

  it("answers 400 when a variant does not exist", async () => {
    ;(quoteShipping as jest.Mock).mockRejectedValue(new Error("Variante não encontrada: v9"))
    const res = makeRes()
    await POST(makeReq({ postalCode: "01310100", items: [{ variantId: "v9", quantity: 1 }] }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe("Variante não encontrada: v9")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... npx jest --runInBand src/api/store/shipping/quote`
Expected: FAIL with "Cannot find module '../route'"

- [ ] **Step 3: Write implementation**

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { getShippingCalculator } from "../../../../utils/melhor-envio"
import { defaultQuoteCache, quoteShipping } from "../../../../utils/shipping-quote"

export const quoteRequestSchema = z.object({
  postalCode: z.string().refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido. Informe 8 dígitos."),
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
})

// Prices, weights and the seller of each item come from the database — the
// browser only says what is in the cart and where it goes.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = quoteRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." })
  }

  try {
    const quote = await quoteShipping(
      {
        query: req.scope.resolve(ContainerRegistrationKeys.QUERY),
        calculator: getShippingCalculator(),
        cache: defaultQuoteCache,
        logger: req.scope.resolve("logger"),
      },
      parsed.data
    )
    res.json(quote)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Não foi possível cotar o frete." })
  }
}
```

Remover a pasta antiga: `git rm -r packages/medusa-backend/apps/backend/src/api/store/shipping/estimate`.

Em `infra/docker-compose.oci.yml` e `infra/docker-compose.prod.yml`: apagar a linha `MELHOR_ENVIO_ORIGIN_CEP: ...` e acrescentar logo abaixo de `MELHOR_ENVIO_TOKEN`:

```yaml
      SHIPPING_HANDLING_DAYS: ${SHIPPING_HANDLING_DAYS:-2}
```

Em `.env.template` trocar o bloco de Melhor Envio por:

```
# MELHOR_ENVIO_TOKEN: token Melhor Envio. Ambiente de teste usa o token do SANDBOX
# (sandbox.melhorenvio.com.br > Integrações > Permissões de acesso). Sem token,
# só desenvolvimento local (NODE_ENV=development) recebe cotações falsas.
# A origem do frete é o endereço de cada loja (cadastro do vendedor).
MELHOR_ENVIO_TOKEN=
# Dias úteis de manuseio somados ao prazo da transportadora (padrão 2).
SHIPPING_HANDLING_DAYS=2
```

Em `docs/DEPLOY_OCI.md` (linhas ~149-150 e ~200-201): remover `MELHOR_ENVIO_ORIGIN_CEP=44300000` e anotar ao lado de `MELHOR_ENVIO_TOKEN=` `# no servidor de teste: token do sandbox do Melhor Envio`.

- [ ] **Step 4: Run tests**

Run: `... npx jest --runInBand src/api/store/shipping` and `grep -rn "MELHOR_ENVIO_ORIGIN_CEP\|shipping/estimate" packages infra docs apps --include=* | grep -v node_modules | grep -v "docs/superpowers"`
Expected: PASS; grep vazio (exceto specs/planos históricos)

- [ ] **Step 5: Commit**

```bash
git add -A packages/medusa-backend/apps/backend/src/api/store/shipping infra packages/medusa-backend/apps/backend/.env.template docs/DEPLOY_OCI.md
git commit -m "feat(frete): expor cotação por loja e remover estimativa de origem fixa"
```

---

### Task 7: Checkout recalcula o frete no servidor e grava o serviço por loja

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/utils/seller-order-groups.ts`
- Modify: `packages/medusa-backend/apps/backend/src/utils/checkout-payload.ts`
- Create: `packages/medusa-backend/apps/backend/src/utils/checkout-shipping.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/store/checkout/sandbox-cash/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/utils/create-orders-from-checkout.ts`
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts:13-17` (só o comentário que cita o rateio do frete)
- Test: `utils/__tests__/seller-order-groups.unit.spec.ts` (reescrever), `utils/__tests__/checkout-payload.unit.spec.ts`, `utils/__tests__/checkout-shipping.unit.spec.ts` (novo), `utils/__tests__/create-orders-from-checkout.unit.spec.ts`, `api/store/checkout/preference/__tests__/route.unit.spec.ts`, `api/store/checkout/sandbox-cash/__tests__/*`

**Interfaces:**
- Consumes: `ShippingOption`, `SellerShipping`, `ShippingTier`, `quoteShipping`, `defaultQuoteCache` (Task 5); `getShippingCalculator` (Task 4)
- Produces:
  - `SellerGroup` ganha `shipping?: Omit<SellerShipping, "sellerId" | "sellerName">`
  - `groupItemsBySeller(items, sellerByProductId, shippingBySeller: Record<string, SellerShipping>)` — `shippingShare = shippingBySeller[sellerId]?.price ?? 0`
  - `checkoutRequestSchema.shape.shipping` = `{ tier: "economico" | "rapido"; expectedTotal: number }`; `items[].variantId` passa a obrigatório
  - `buildCheckoutSnapshot(query, request, option: ShippingOption)`; snapshot `shipping = { id: option.tier, name: option.label, price: option.total }`, `total = soma dos itens + option.total`
  - `resolveCheckoutShipping(deps: { query; calculator; cache? ; logger? }, request: CheckoutRequest): Promise<{ ok: true; option: ShippingOption } | { ok: false; status: 409 | 422; body: Record<string, unknown> }>`
  - Pedido: `shipping_methods[0].name = "Correios PAC" | "Correios SEDEX"`, `metadata.shipping_tier`, `metadata.shipping_service_id`

- [ ] **Step 1: Write the failing tests**

`utils/__tests__/seller-order-groups.unit.spec.ts` — substituir todo o conteúdo:

```ts
import { groupItemsBySeller, type PreferenceItem } from "../seller-order-groups"
import type { SellerShipping } from "../shipping-quote"

const item = (overrides: Partial<PreferenceItem>): PreferenceItem => ({
  title: "Item", quantity: 1, price: 1000, productId: "prod-1", variantId: "var-1", ...overrides,
})
const pac = (sellerId: string, price: number): SellerShipping => ({
  sellerId, sellerName: sellerId, tier: "economico", service: "PAC", serviceId: 1, price, deliveryDays: 9,
})

describe("groupItemsBySeller", () => {
  it("uses each seller's real shipping price as its share and keeps the chosen service", () => {
    const result = groupItemsBySeller(
      [item({ productId: "prod-1", price: 7900 }), item({ productId: "prod-2", price: 5000, variantId: "var-2" })],
      { "prod-1": "seller-a", "prod-2": "seller-b" },
      { "seller-a": pac("seller-a", 3679), "seller-b": pac("seller-b", 8190) }
    )
    if (!("groups" in result)) throw new Error("expected groups")
    expect(result.groups.map((g) => [g.sellerId, g.subtotal, g.shippingShare])).toEqual([
      ["seller-a", 7900, 3679],
      ["seller-b", 5000, 8190],
    ])
    expect(result.groups[0].shipping).toEqual({ tier: "economico", service: "PAC", serviceId: 1, price: 3679, deliveryDays: 9 })
  })

  it("groups several items of the same seller into one group", () => {
    const result = groupItemsBySeller(
      [item({ price: 1000 }), item({ price: 500, quantity: 2, variantId: "var-2" })],
      { "prod-1": "seller-a" },
      { "seller-a": pac("seller-a", 2000) }
    )
    if (!("groups" in result)) throw new Error("expected groups")
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].subtotal).toBe(2000)
    expect(result.groups[0].items).toHaveLength(2)
  })

  it("reports a product without seller", () => {
    expect(groupItemsBySeller([item({ productId: "x" })], {}, {})).toEqual({ unresolvedProductId: "x" })
  })
})
```

`utils/__tests__/checkout-shipping.unit.spec.ts`:

```ts
jest.mock("../shipping-quote", () => ({ ...jest.requireActual("../shipping-quote"), quoteShipping: jest.fn() }))
import { quoteShipping, type ShippingOption } from "../shipping-quote"
import { resolveCheckoutShipping } from "../checkout-shipping"

const option = (tier: "economico" | "rapido", total: number): ShippingOption => ({
  tier, label: tier === "economico" ? "Econômico" : "Rápido", total, deliveryDays: 11,
  sellers: [{ sellerId: "s1", sellerName: "Loja", tier, service: tier === "economico" ? "PAC" : "SEDEX", serviceId: 1, price: total, deliveryDays: 9 }],
})
const request: any = {
  items: [{ title: "Colar", quantity: 2, price: 7700, variantId: "var-1", productId: "prod-1" }],
  address: { cep: "01310-100" },
  shipping: { tier: "economico", expectedTotal: 3679 },
}
const deps: any = { query: {}, calculator: jest.fn() }

describe("resolveCheckoutShipping", () => {
  beforeEach(() => (quoteShipping as jest.Mock).mockReset())

  it("re-quotes with the cart variants and the delivery CEP and returns the chosen option", async () => {
    ;(quoteShipping as jest.Mock).mockResolvedValue({ options: [option("economico", 3679), option("rapido", 7572)], unavailableSellers: [] })
    const result = await resolveCheckoutShipping(deps, request)
    expect(quoteShipping).toHaveBeenCalledWith(expect.objectContaining({ query: deps.query, calculator: deps.calculator }), {
      postalCode: "01310-100",
      items: [{ variantId: "var-1", quantity: 2 }],
    })
    expect(result).toEqual({ ok: true, option: option("economico", 3679) })
  })

  it("answers 409 with the new quote when the price changed", async () => {
    const quote = { options: [option("economico", 3900)], unavailableSellers: [] }
    ;(quoteShipping as jest.Mock).mockResolvedValue(quote)
    const result = await resolveCheckoutShipping(deps, request)
    expect(result).toEqual({ ok: false, status: 409, body: { error: "O valor do frete foi atualizado", quote } })
  })

  it("answers 422 when a seller became unavailable or the tier vanished", async () => {
    const unavailable = { options: [option("economico", 3679)], unavailableSellers: [{ sellerId: "s2", sellerName: "Loja 2", reason: "missing_address", productTitles: ["Bolsa"] }] }
    ;(quoteShipping as jest.Mock).mockResolvedValue(unavailable)
    expect(await resolveCheckoutShipping(deps, request)).toEqual({
      ok: false, status: 422,
      body: { error: "Frete indisponível para alguns produtos do carrinho", quote: unavailable },
    })

    const noTier = { options: [option("rapido", 7572)], unavailableSellers: [] }
    ;(quoteShipping as jest.Mock).mockResolvedValue(noTier)
    expect(await resolveCheckoutShipping(deps, request)).toEqual({
      ok: false, status: 422, body: { error: "Opção de frete indisponível", quote: noTier },
    })
  })
})
```

`utils/__tests__/checkout-payload.unit.spec.ts` — atualizar `request.shipping` para `{ tier: "economico", expectedTotal: 5500 }`, chamar `buildCheckoutSnapshot(query, request, option)` com:

```ts
const option = {
  tier: "economico" as const, label: "Econômico", total: 5500, deliveryDays: 11,
  sellers: [
    { sellerId: "seller-a", sellerName: "A", tier: "economico" as const, service: "PAC" as const, serviceId: 1, price: 2500, deliveryDays: 9 },
    { sellerId: "seller-b", sellerName: "B", tier: "economico" as const, service: "PAC" as const, serviceId: 1, price: 3000, deliveryDays: 7 },
  ],
}
```

e acrescentar:

```ts
  it("stores each seller's real shipping and the server-side total", async () => {
    const query = makeQuery({ "prod-1": "seller-a", "prod-2": "seller-b" })
    const result = await buildCheckoutSnapshot(query, request, option)
    if (!("payload" in result)) throw new Error("expected payload")
    expect(result.payload.seller_groups.map((g) => g.shippingShare)).toEqual([2500, 3000])
    expect(result.payload.shipping).toEqual({ id: "economico", name: "Econômico", price: 5500 })
    expect(result.payload.total).toBe(2 * 7900 + 5000 + 5500)
  })

  it("rejects the old shipping shape (price sent by the browser)", () => {
    expect(checkoutRequestSchema.safeParse({ ...request, shipping: { id: "pac", name: "PAC", price: 1 } }).success).toBe(false)
  })
```

`utils/__tests__/create-orders-from-checkout.unit.spec.ts` — acrescentar:

```ts
  it("names the shipping method after the seller's real service and stores tier and service id", async () => {
    const container = makeContainer()
    const meta: CheckoutMeta = {
      ...twoSellerMeta,
      shipping: { id: "economico", name: "Econômico", price: 2500 },
      seller_groups: twoSellerMeta.seller_groups!.map((g, i) => ({
        ...g,
        shipping: { tier: "economico", service: "PAC", serviceId: 1, price: g.shippingShare, deliveryDays: 9 + i },
      })),
    }
    await createOrdersFromCheckout({ container, externalReference: "ref-1", meta })
    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input[0].shipping_methods).toEqual([{ name: "Correios PAC", amount: 1500 }])
    expect(input[0].metadata).toEqual(expect.objectContaining({ shipping_tier: "economico", shipping_service_id: 1 }))
  })

  it("keeps legacy snapshots working (groups without per-seller shipping)", async () => {
    const container = makeContainer()
    await createOrdersFromCheckout({ container, externalReference: "ref-1", meta: twoSellerMeta })
    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input[0].shipping_methods).toEqual([{ name: "PAC", amount: 1500 }])
    expect(input[0].metadata.shipping_service_id).toBeUndefined()
  })
```

`api/store/checkout/preference/__tests__/route.unit.spec.ts` — adicionar no topo `jest.mock("../../../../../utils/checkout-shipping", () => ({ resolveCheckoutShipping: jest.fn() }))` e `jest.mock("../../../../../utils/melhor-envio", () => ({ getShippingCalculator: () => null }))`; em `beforeEach`, `resolveCheckoutShipping` resolve `{ ok: true, option }` com uma opção de uma loja `seller-1`, total 2500, label "Econômico", tier "economico"; trocar `validBody.shipping` por `{ tier: "economico", expectedTotal: 2500 }`. Acrescentar:

```ts
  it("charges the server-side shipping as the 'Frete — Econômico' item", async () => {
    const req = makeReq(validBody)
    const res = makeRes()
    MockPreference.prototype.create = jest.fn().mockResolvedValue({ id: "pref-1", init_point: "x" }) as any
    await POST(req, res)
    const body = (MockPreference.prototype.create as jest.Mock).mock.calls[0][0].body
    expect(body.items).toContainEqual(expect.objectContaining({ id: "frete-economico", title: "Frete — Econômico", unit_price: 25 }))
  })

  it("passes through 409 when the shipping price changed, without creating a preference", async () => {
    ;(resolveCheckoutShipping as jest.Mock).mockResolvedValueOnce({ ok: false, status: 409, body: { error: "O valor do frete foi atualizado", quote: {} } })
    const req = makeReq(validBody)
    const res = makeRes()
    MockPreference.prototype.create = jest.fn() as any
    await POST(req, res)
    expect(res._status).toBe(409)
    expect(MockPreference.prototype.create).not.toHaveBeenCalled()
    expect(req._checkoutService.recordSnapshot).not.toHaveBeenCalled()
  })
```

Atualizar também os testes do `sandbox-cash` (`api/store/checkout/sandbox-cash/__tests__`) com o mesmo mock de `resolveCheckoutShipping` e o novo `shipping`, e um caso de 422 que não cria pedido.

- [ ] **Step 2: Run tests to verify they fail**

Run: `... npx jest --runInBand src/utils/__tests__/seller-order-groups src/utils/__tests__/checkout-payload src/utils/__tests__/checkout-shipping src/utils/__tests__/create-orders-from-checkout src/api/store/checkout`
Expected: FAIL (assinaturas antigas, módulo `checkout-shipping` inexistente)

- [ ] **Step 3: Implement**

`utils/seller-order-groups.ts` — novo conteúdo:

```ts
import type { SellerShipping } from "./shipping-quote"

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
  // Absent on snapshots created before per-seller shipping (cycle 2).
  shipping?: Omit<SellerShipping, "sellerId" | "sellerName">
  items: Array<{ variant_id?: string; title: string; quantity: number; price: number }>
}

/** One group per seller; each group's shipping is that seller's real quote. */
export function groupItemsBySeller(
  items: PreferenceItem[],
  sellerByProductId: Record<string, string>,
  shippingBySeller: Record<string, SellerShipping>
): { groups: SellerGroup[] } | { unresolvedProductId: string } {
  for (const item of items) {
    if (!sellerByProductId[item.productId]) return { unresolvedProductId: item.productId }
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
    group.items.push({ variant_id: item.variantId, title: item.title, quantity: item.quantity, price: item.price })
  }

  return {
    groups: order.map((sellerId) => {
      const s = shippingBySeller[sellerId]
      return {
        sellerId,
        subtotal: bySeller.get(sellerId)!.subtotal,
        shippingShare: s?.price ?? 0,
        ...(s
          ? { shipping: { tier: s.tier, service: s.service, serviceId: s.serviceId, price: s.price, deliveryDays: s.deliveryDays } }
          : {}),
        items: bySeller.get(sellerId)!.items,
      }
    }),
  }
}
```

`utils/checkout-payload.ts`:
- no schema: `variantId: z.string()` (obrigatório) e
  ```ts
  shipping: z.object({
    tier: z.enum(["economico", "rapido"]),
    // What the buyer saw; the server re-quotes and answers 409 if it changed.
    expectedTotal: z.number().int().nonnegative(),
  }),
  ```
- `CheckoutSnapshotPayload.shipping` continua `{ id: string; name: string; price: number }`.
- `buildCheckoutSnapshot(query, request, option: ShippingOption)`:
  ```ts
  const shippingBySeller = Object.fromEntries(option.sellers.map((s) => [s.sellerId, s]))
  const grouped = groupItemsBySeller(items, sellerByProductId, shippingBySeller)
  ...
  shipping: { id: option.tier, name: option.label, price: option.total },
  total: items.reduce((s, i) => s + i.price * i.quantity, 0) + option.total,
  ```
  (remover `total` e `shipping` da desestruturação de `request` que deixaram de ser usados).

`utils/checkout-shipping.ts`:

```ts
import type { CheckoutRequest } from "./checkout-payload"
import type { ShippingCalculator } from "./melhor-envio"
import { quoteShipping, type QuoteCache, type ShippingOption } from "./shipping-quote"

type Deps = {
  query: { graph: (args: any) => Promise<{ data: any[] }> }
  calculator: ShippingCalculator | null
  cache?: QuoteCache
  logger?: { error: (m: string) => void }
}

/**
 * Re-quotes the cart on the server so the charged shipping is never the
 * browser's number. 409 = price changed since the buyer saw it (they confirm
 * again); 422 = something in the cart can no longer be shipped.
 */
export async function resolveCheckoutShipping(
  deps: Deps,
  request: CheckoutRequest
): Promise<{ ok: true; option: ShippingOption } | { ok: false; status: 409 | 422; body: Record<string, unknown> }> {
  const quote = await quoteShipping(deps, {
    postalCode: request.address.cep,
    items: request.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
  })

  if (quote.unavailableSellers.length > 0) {
    return { ok: false, status: 422, body: { error: "Frete indisponível para alguns produtos do carrinho", quote } }
  }
  const option = quote.options.find((o) => o.tier === request.shipping.tier)
  if (!option) {
    return { ok: false, status: 422, body: { error: "Opção de frete indisponível", quote } }
  }
  if (option.total !== request.shipping.expectedTotal) {
    return { ok: false, status: 409, body: { error: "O valor do frete foi atualizado", quote } }
  }
  return { ok: true, option }
}
```

`api/store/checkout/preference/route.ts` — depois do `safeParse`:

```ts
  const { items, address } = parsed.data
  ...
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const shipping = await resolveCheckoutShipping(
    { query, calculator: getShippingCalculator(), cache: defaultQuoteCache, logger: req.scope.resolve("logger") },
    parsed.data
  )
  if (!shipping.ok) return res.status(shipping.status).json(shipping.body)
  const option = shipping.option

  const built = await buildCheckoutSnapshot(query, parsed.data, option)
```

e o item de frete da preferência:

```ts
          ...(option.total > 0
            ? [{
                id: `frete-${option.tier}`,
                title: `Frete — ${option.label}`,
                quantity: 1,
                unit_price: option.total / 100,
                currency_id: "BRL",
              }]
            : []),
```

Imports novos: `resolveCheckoutShipping` de `../../../../utils/checkout-shipping`, `getShippingCalculator` de `../../../../utils/melhor-envio`, `defaultQuoteCache` de `../../../../utils/shipping-quote`.

`api/store/checkout/sandbox-cash/route.ts` — mesma inserção (resolver → 409/422 → `buildCheckoutSnapshot(query, parsed.data, shipping.option)`).

`utils/create-orders-from-checkout.ts`:

```ts
      shipping_methods: group.shipping
        ? [{ name: `Correios ${group.shipping.service}`, amount: group.shippingShare }]
        : shipping
          ? [{ name: shipping.name, amount: group.shippingShare }]
          : [],
      metadata: {
        mercadopago_external_reference: externalReference,
        seller_id: group.sellerId,
        buyer_document: meta.buyer_document,
        shipping_status: INITIAL_SHIPPING_STATUS,
        // Cycle 3 buys exactly this label for the seller's package.
        ...(group.shipping ? { shipping_tier: group.shipping.tier, shipping_service_id: group.shipping.serviceId } : {}),
        ...extraMetadata,
      },
```

`subscribers/commission-on-payment.ts` — no comentário das linhas 13-17, trocar "(mesmo algoritmo de rateio do frete em seller-order-groups.ts)" por "(rateio proporcional ao subtotal de produtos, ver allocateFixedFee)".

- [ ] **Step 4: Run tests**

Run: `... npx jest --runInBand` (suíte unitária inteira do backend)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src
git commit -m "feat(checkout): recalcular frete por loja no servidor e gravar o serviço nos pedidos"
```

---

### Task 8: Tamanho da embalagem no cadastro de produto do lojista (backend)

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/seller/products/route.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/seller/products/[id]/route.ts`
- Test: `api/seller/products/__tests__/package-size.unit.spec.ts` (novo), `api/seller/products/[id]/__tests__/package-size.unit.spec.ts` (novo)

**Interfaces:**
- Consumes: `PackageSize`, `PackageDimensions`, `resolvePackageDimensions`, `exceedsCorreiosLimits` (Task 1)
- Produces: corpo de `POST /seller/products` e `PATCH /seller/products/:id` aceita `packageSize?: PackageSize` e `packageDimensions?: PackageDimensions`. Ao criar: variantes recebem `weight/length/width/height`; produto recebe `metadata.package_size` e, se `bulky`, `metadata.package_review = "pending"`. Ao editar: mesmas regras, preservando o restante de `metadata` (lido via `query.graph` campo `metadata`), e as variantes existentes recebem as medidas via `productService.updateProductVariants({ product_id: id }, dims)`. 400 `{ error: "Medidas acima do limite dos Correios (máx. 100 cm por lado, 200 cm somando os lados, 30 kg)" }` quando exceder; 400 `{ error: "Volumoso exige peso e medidas maiores que zero" }` sem medidas. `GET /seller/products/:id` passa a devolver `metadata` e `variants.weight/length/width/height`.

- [ ] **Step 1: Write the failing tests**

`api/seller/products/__tests__/package-size.unit.spec.ts`:

```ts
const run = jest.fn()
jest.mock("@medusajs/medusa/core-flows", () => ({ createProductsWorkflow: () => ({ run }) }))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeReq(body: unknown) {
  const link = { create: jest.fn() }
  return {
    body,
    sellerId: "s1",
    scope: { resolve: (k: string) => (k === Modules.PRODUCT ? {} : k === ContainerRegistrationKeys.LINK ? link : undefined) },
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}
const base = { title: "Colar de sementes", variants: [{ title: "Default", prices: [{ amount: 7700, currency_code: "brl" }] }] }

describe("POST /seller/products — package size", () => {
  beforeEach(() => run.mockReset().mockResolvedValue({ result: [{ id: "prod-1" }] }))

  it("writes the preset dimensions on every variant and the size in metadata", async () => {
    const res = makeRes()
    await POST(makeReq({ ...base, packageSize: "small" }), res)
    expect(res._status).toBe(201)
    const product = run.mock.calls[0][0].input.products[0]
    expect(product.variants[0]).toEqual(expect.objectContaining({ weight: 0.3, length: 16, width: 11, height: 6 }))
    expect(product.metadata).toEqual({ package_size: "small" })
  })

  it("stores bulky custom dimensions and flags them for team review", async () => {
    const res = makeRes()
    const dims = { weight: 1.2, length: 65, width: 40, height: 50 }
    await POST(makeReq({ ...base, packageSize: "bulky", packageDimensions: dims }), res)
    const product = run.mock.calls[0][0].input.products[0]
    expect(product.variants[0]).toEqual(expect.objectContaining(dims))
    expect(product.metadata).toEqual({ package_size: "bulky", package_review: "pending" })
  })

  it("rejects bulky without dimensions and dimensions above the Correios limits", async () => {
    let res = makeRes()
    await POST(makeReq({ ...base, packageSize: "bulky" }), res)
    expect(res._status).toBe(400)
    res = makeRes()
    await POST(makeReq({ ...base, packageSize: "bulky", packageDimensions: { weight: 1.8, length: 35, width: 120, height: 115 } }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toMatch(/limite dos Correios/)
    expect(run).not.toHaveBeenCalled()
  })

  it("defaults to medium when no size is sent", async () => {
    const res = makeRes()
    await POST(makeReq(base), res)
    const product = run.mock.calls[0][0].input.products[0]
    expect(product.variants[0]).toEqual(expect.objectContaining({ weight: 1, length: 25, width: 20, height: 10 }))
    expect(product.metadata).toEqual({ package_size: "medium" })
  })
})
```

`api/seller/products/[id]/__tests__/package-size.unit.spec.ts`:

```ts
const run = jest.fn()
jest.mock("@medusajs/medusa/core-flows", () => ({ updateProductsWorkflow: () => ({ run }) }))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PATCH } from "../route"

function makeReq(body: unknown) {
  const productService = { updateProductVariants: jest.fn() }
  const graph = jest.fn(async ({ entity }: any) =>
    entity === "seller"
      ? { data: [{ products: [{ id: "prod-1" }] }] }
      : { data: [{ id: "prod-1", metadata: { origin: "nuvemshop", package_review: "approved" } }] }
  )
  return {
    body, params: { id: "prod-1" }, sellerId: "s1",
    scope: { resolve: (k: string) => (k === Modules.PRODUCT ? productService : k === ContainerRegistrationKeys.QUERY ? { graph } : undefined) },
    _productService: productService,
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("PATCH /seller/products/:id — package size", () => {
  beforeEach(() => run.mockReset().mockResolvedValue({ result: [{ id: "prod-1" }] }))

  it("updates every variant's dimensions and merges metadata", async () => {
    const req = makeReq({ packageSize: "large" })
    const res = makeRes()
    await PATCH(req, res)
    expect(res._status).toBe(200)
    expect(req._productService.updateProductVariants).toHaveBeenCalledWith(
      { product_id: "prod-1" },
      { weight: 3, length: 40, width: 30, height: 20 }
    )
    expect(run.mock.calls[0][0].input.update.metadata).toEqual({ origin: "nuvemshop", package_size: "large", package_review: "approved" })
  })

  it("marks bulky edits for review again", async () => {
    const req = makeReq({ packageSize: "bulky", packageDimensions: { weight: 1, length: 50, width: 50, height: 50 } })
    await PATCH(req, makeRes())
    expect(run.mock.calls[0][0].input.update.metadata).toEqual(expect.objectContaining({ package_size: "bulky", package_review: "pending" }))
  })

  it("does not touch dimensions when no package size is sent", async () => {
    const req = makeReq({ title: "Novo título" })
    await PATCH(req, makeRes())
    expect(req._productService.updateProductVariants).not.toHaveBeenCalled()
    expect(run.mock.calls[0][0].input.update.metadata).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `... npx jest --runInBand src/api/seller/products`
Expected: FAIL (campos desconhecidos/ignorados)

- [ ] **Step 3: Implement**

Em ambos os arquivos, acrescentar ao schema zod:

```ts
const packageFields = {
  packageSize: z.enum(["small", "medium", "large", "bulky"]).optional(),
  packageDimensions: z
    .object({ weight: z.number().positive(), length: z.number().positive(), width: z.number().positive(), height: z.number().positive() })
    .optional(),
}
```

(`CreateProductSchema = z.object({ ...campos atuais, ...packageFields })`; idem `UpdateProductSchema`.)

Helper compartilhado — criar `api/seller/products/package.ts`:

```ts
import {
  exceedsCorreiosLimits,
  resolvePackageDimensions,
  type PackageDimensions,
  type PackageSize,
} from "../../../utils/package-size"

export const LIMIT_ERROR = "Medidas acima do limite dos Correios (máx. 100 cm por lado, 200 cm somando os lados, 30 kg)"

/** Resolves the dimensions for a size, or returns the 400 message to show. */
export function resolveSellerPackage(
  size: PackageSize,
  custom?: PackageDimensions
): { ok: true; dims: PackageDimensions; metadata: Record<string, string> } | { ok: false; error: string } {
  let dims: PackageDimensions
  try {
    dims = resolvePackageDimensions(size, custom)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  if (exceedsCorreiosLimits(dims)) return { ok: false, error: LIMIT_ERROR }
  // Seller-measured boxes are the error-prone ones; the team reviews them.
  return { ok: true, dims, metadata: size === "bulky" ? { package_size: size, package_review: "pending" } : { package_size: size } }
}
```

`POST` (criação): após o `safeParse` e antes do workflow:

```ts
  const pkg = resolveSellerPackage(parsed.data.packageSize ?? "medium", parsed.data.packageDimensions)
  if (!pkg.ok) return res.status(400).json({ error: pkg.error })
```

e no input do workflow: `metadata: pkg.metadata,` no produto e `...pkg.dims,` em cada variante do `variants.map`.

`PATCH` (edição): separar `packageSize`/`packageDimensions` de `rest`:

```ts
  const { category_id, packageSize, packageDimensions, ...rest } = parsed.data
  ...
  if (packageSize) {
    const pkg = resolveSellerPackage(packageSize, packageDimensions)
    if (!pkg.ok) return res.status(400).json({ error: pkg.error })
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [current] } = await query.graph({ entity: "product", fields: ["id", "metadata"], filters: { id } })
    const existing = (current?.metadata ?? {}) as Record<string, unknown>
    // Re-review only when the seller measured the box; presets keep the team's verdict.
    updateData.metadata = { ...existing, ...pkg.metadata }
    await productService.updateProductVariants({ product_id: id }, pkg.dims)
  }
```

`GET /seller/products/:id`: acrescentar `"metadata"`, `"variants.weight"`, `"variants.length"`, `"variants.width"`, `"variants.height"` aos `fields`.

- [ ] **Step 4: Run tests**

Run: `... npx jest --runInBand src/api/seller/products`
Expected: PASS (inclusive os testes antigos de criação/edição)

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/seller/products
git commit -m "feat(produtos): gravar tamanho da embalagem e medidas nas variantes do lojista"
```

---

### Task 9: Admin — endereço da loja e revisão de medidas

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/admin/products/[id]/package-review/route.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/admin/products/[id]/package-review/__tests__/route.unit.spec.ts`
- Create: `packages/medusa-backend/apps/backend/src/admin/widgets/product-package-review.tsx`
- Test: `packages/medusa-backend/apps/backend/src/admin/widgets/__tests__/product-package-review.test.tsx`
- Modify: `packages/medusa-backend/apps/backend/src/admin/hooks/sellers.ts`
- Modify: `packages/medusa-backend/apps/backend/src/admin/routes/sellers/[id]/page.tsx`
- Test: `packages/medusa-backend/apps/backend/src/admin/routes/sellers/[id]/__tests__/address.test.tsx`

**Interfaces:**
- Consumes: `PACKAGE_SIZE_LABELS` (Task 1), `hasShippingOrigin` (Task 2), `PUT /admin/sellers/:id` com endereço (Task 3)
- Produces: `POST /admin/products/:id/package-review` `{ status: "approved" }` → `{ product }` (merge em `metadata.package_review`); widget zona `product.details.side.before`; hook `useUpdateSeller()` (`PUT /admin/sellers/:id`); tipo `Seller` com os 7 campos de endereço; seção "Endereço de envio" no detalhe da loja.

- [ ] **Step 1: Write the failing tests**

`api/admin/products/[id]/package-review/__tests__/route.unit.spec.ts`:

```ts
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeReq(body: unknown) {
  const productService = { updateProducts: jest.fn(async (id: string, data: any) => ({ id, ...data })) }
  const graph = jest.fn().mockResolvedValue({ data: [{ id: "prod-1", metadata: { package_size: "bulky", package_review: "pending", origin: "x" } }] })
  return {
    body, params: { id: "prod-1" },
    scope: { resolve: (k: string) => (k === Modules.PRODUCT ? productService : k === ContainerRegistrationKeys.QUERY ? { graph } : undefined) },
    _productService: productService,
  } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("POST /admin/products/:id/package-review", () => {
  it("marks the measures as approved keeping the rest of the metadata", async () => {
    const req = makeReq({ status: "approved" })
    const res = makeRes()
    await POST(req, res)
    expect(req._productService.updateProducts).toHaveBeenCalledWith("prod-1", {
      metadata: { package_size: "bulky", package_review: "approved", origin: "x" },
    })
    expect(res._status).toBe(200)
  })

  it("rejects other statuses", async () => {
    const res = makeRes()
    await POST(makeReq({ status: "whatever" }), res)
    expect(res._status).toBe(400)
  })
})
```

`admin/widgets/__tests__/product-package-review.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@medusajs/admin-sdk", () => ({ defineWidgetConfig: (c: unknown) => c }))
vi.mock("../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn().mockResolvedValue({ product: {} }) } } }))

import { sdk } from "../../lib/sdk"
import Widget, { config } from "../product-package-review"

function renderWidget(data: any) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}><Widget data={data} /></QueryClientProvider>)
}

describe("ProductPackageReviewWidget", () => {
  it("sits on the product details page", () => {
    expect((config as any).zone).toBe("product.details.side.before")
  })

  it("shows the package size and lets the team approve pending measures", async () => {
    renderWidget({ id: "prod-1", metadata: { package_size: "bulky", package_review: "pending" }, variants: [{ weight: 1.2, length: 65, width: 40, height: 50 }] })
    expect(screen.getByText("Volumoso")).toBeInTheDocument()
    expect(screen.getByText("65 × 40 × 50 cm · 1.2 kg")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Medidas conferidas" }))
    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/products/prod-1/package-review", { method: "POST", body: { status: "approved" } })
  })

  it("renders nothing for products without package metadata (imported catalog)", () => {
    const { container } = renderWidget({ id: "prod-2", metadata: {}, variants: [] })
    expect(container).toBeEmptyDOMElement()
  })
})
```

`admin/routes/sellers/[id]/__tests__/address.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { sdk } from "../../../../lib/sdk"
import SellerDetailPage from "../page"

vi.mock("../../../../lib/sdk", () => ({ sdk: { client: { fetch: vi.fn() } } }))

const seller = {
  id: "seller_1", name: "Loja Oficial", ownerName: "Maria", email: "a@b.com", phone: "71999999999",
  cpfCnpj: "12345678900", bio: null, location: null, category: null, status: "pending", rejectionReason: null,
  addressPostalCode: null, addressStreet: null, addressNumber: null, addressComplement: null,
  addressDistrict: null, addressCity: null, addressState: null,
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sellers/seller_1"]}>
        <Routes><Route path="/sellers/:id" element={<SellerDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("SellerDetailPage — shipping address", () => {
  beforeEach(() => vi.mocked(sdk.client.fetch).mockReset())

  it("warns when the shipping address is incomplete", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller })
    renderDetail()
    expect(await screen.findByText(/Endereço de envio incompleto/)).toBeInTheDocument()
  })

  it("saves the address through PUT /admin/sellers/:id", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller })
    const user = userEvent.setup()
    renderDetail()
    await user.type(await screen.findByLabelText("CEP"), "44300000")
    await user.type(screen.getByLabelText("Rua"), "Rua Sete de Setembro")
    await user.type(screen.getByLabelText("Número"), "10")
    await user.type(screen.getByLabelText("Bairro"), "Centro Histórico")
    await user.type(screen.getByLabelText("Cidade"), "Cachoeira")
    await user.type(screen.getByLabelText("UF"), "BA")
    await user.click(screen.getByRole("button", { name: "Salvar endereço" }))
    await waitFor(() =>
      expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1", {
        method: "PUT",
        body: expect.objectContaining({ addressPostalCode: "44300000", addressCity: "Cachoeira", addressState: "BA" }),
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run backend: `... npx jest --runInBand src/api/admin/products`
Run admin: `... vitest run --config src/admin/vitest.config.ts widgets routes/sellers`
Expected: FAIL (módulos inexistentes)

- [ ] **Step 3: Implement**

`api/admin/products/[id]/package-review/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { z } from "zod"

const Body = z.object({ status: z.literal("approved") })

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Status inválido" })

  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [product] } = await query.graph({ entity: "product", fields: ["id", "metadata"], filters: { id } })
  if (!product) return res.status(404).json({ error: "Produto não encontrado" })

  // The full metadata object is sent so the update never drops other keys.
  const updated = await req.scope.resolve(Modules.PRODUCT).updateProducts(id, {
    metadata: { ...(product.metadata ?? {}), package_review: parsed.data.status },
  })
  res.json({ product: updated })
}
```

`admin/widgets/product-package-review.tsx`:

```tsx
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"
import { PACKAGE_SIZE_LABELS, type PackageSize } from "../../utils/package-size"

const ProductPackageReviewWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const queryClient = useQueryClient()
  const approve = useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/admin/products/${data.id}/package-review`, { method: "POST", body: { status: "approved" } }),
    onSuccess: () => {
      toast.success("Medidas conferidas")
      queryClient.invalidateQueries()
    },
  })

  const size = data.metadata?.package_size as PackageSize | undefined
  if (!size) return null
  const review = data.metadata?.package_review as string | undefined
  const v = (data.variants ?? [])[0] as any

  return (
    <Container className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-center justify-between">
        <Heading level="h2">Embalagem</Heading>
        {review === "pending" ? (
          <StatusBadge color="orange">Medidas a conferir</StatusBadge>
        ) : review === "approved" ? (
          <StatusBadge color="green">Conferidas</StatusBadge>
        ) : null}
      </div>
      <Text>{PACKAGE_SIZE_LABELS[size] ?? size}</Text>
      {v?.length ? (
        <Text size="small" className="text-ui-fg-subtle">{`${v.length} × ${v.width} × ${v.height} cm · ${v.weight} kg`}</Text>
      ) : null}
      {review === "pending" && (
        <Button size="small" variant="secondary" isLoading={approve.isPending} onClick={() => approve.mutate()}>
          Medidas conferidas
        </Button>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: "product.details.side.before" })

export default ProductPackageReviewWidget
```

`admin/hooks/sellers.ts` — acrescentar ao tipo `Seller` os 7 campos `addressX: string | null` e:

```ts
export type SellerAddressInput = {
  addressPostalCode: string
  addressStreet: string
  addressNumber: string
  addressComplement?: string
  addressDistrict: string
  addressCity: string
  addressState: string
}

export function useUpdateSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SellerAddressInput> }) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}`, { method: "PUT", body: data }),
    onSuccess: (_d, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}
```

`admin/routes/sellers/[id]/page.tsx` — novo componente `ShippingAddressSection({ seller })` renderizado após a grade de `ProfileField`:
- Estado local inicializado com os campos do seller.
- Campos com `<Label htmlFor>` + `<Input id>`: "CEP", "Rua", "Número", "Complemento", "Bairro", "Cidade", "UF".
- Se `!hasShippingOrigin(seller)`, mostrar `<Text className="text-ui-fg-error">Endereço de envio incompleto — a loja não pode vender nem ser aprovada.</Text>`.
- Botão "Salvar endereço" → `useUpdateSeller().mutate({ id, data: form }, { onSuccess: toast.success("Endereço salvo"), onError: (e) => toast.error(e.message) })`.
- `handleApprove` `onError`: `(e) => toast.error(e?.message ?? "Não foi possível aprovar o vendedor")` para exibir "Preencha o endereço de envio antes de aprovar".
- Import de `hasShippingOrigin` de `../../../../utils/seller-address`.

- [ ] **Step 4: Run tests**

Run backend: `... npx jest --runInBand src/api/admin/products`
Run admin (suíte toda): `... vitest run --config src/admin/vitest.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/medusa-backend/apps/backend/src/api/admin/products packages/medusa-backend/apps/backend/src/admin
git commit -m "feat(admin): editar endereço da loja e conferir medidas de embalagem"
```

---

### Task 10: Checkout da storefront com Econômico/Rápido

**Files:**
- Modify: `apps/storefront/src/lib/cart-store.ts`
- Create: `apps/storefront/src/app/checkout/shipping-quote.ts`
- Delete: `apps/storefront/src/app/checkout/shipping-rates.ts`
- Create: `apps/storefront/src/app/checkout/ShippingOptions.tsx`
- Modify: `apps/storefront/src/app/checkout/create-preference.ts`, `apps/storefront/src/app/checkout/create-test-cash-order.ts`, `apps/storefront/src/app/checkout/page.tsx`
- Test: `apps/storefront/src/lib/__tests__/cart-store.test.ts` (novo), `apps/storefront/src/app/checkout/__tests__/shipping-options.test.tsx` (novo), atualizar `page.test.ts`, `create-test-cash-order.test.ts`, `checkout-test-cash.test.tsx`, `shipping-step.test.tsx`

**Interfaces:**
- Consumes: `POST /store/shipping/quote` (Task 6) e o contrato 409/422 de `/store/checkout/preference` e `/store/checkout/sandbox-cash` (Task 7)
- Produces:
  - `cart-store.ts`: tipos `ShippingTier`, `SellerShipping`, `ShippingOption`, `UnavailableSeller`, `ShippingQuote` (espelho do backend); `selectedShipping: ShippingOption | null`; `total() = subtotal() + (selectedShipping?.total ?? 0)`; persist `version: 1` com `migrate` que zera `selectedShipping`
  - `fetchShippingQuote(postalCode: string, items: Array<{ variantId: string; quantity: number }>): Promise<ShippingQuote>` (lança em falha de rede ou status ≠ 200)
  - `buildCheckoutRequestBody(items, address, shipping: ShippingOption)` → `{ items, address, shipping: { tier, expectedTotal: shipping.total }, total, document }`
  - `type CheckoutResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; quote?: ShippingQuote }`
  - `createPreference(...)`: `Promise<CheckoutResult<PreferenceData>>`; `createTestCashOrder(...)`: `Promise<CheckoutResult<{ externalReference: string }>>`
  - `<ShippingOptions quote selected onSelect onRetry />`

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/cart-store.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useCartStore } from '../cart-store'

describe('cart store shipping', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [], selectedShipping: null })
  })

  it('adds the selected option total to the cart total', () => {
    useCartStore.setState({
      items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7700, quantity: 2 }],
    })
    useCartStore.getState().setShipping({ tier: 'economico', label: 'Econômico', total: 3679, deliveryDays: 11, sellers: [] })
    expect(useCartStore.getState().total()).toBe(2 * 7700 + 3679)
  })

  it('drops a persisted legacy shipping selection (price without tier) on rehydrate', async () => {
    localStorage.setItem('mercado-preto-cart', JSON.stringify({
      state: {
        items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7700, quantity: 1 }],
        selectedShipping: { id: 'pac', name: 'PAC', company: 'Correios', price: 2490, currency: 'brl', delivery_time: '7 dias' },
      },
      version: 0,
    }))
    await useCartStore.persist.rehydrate()
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().selectedShipping).toBeNull()
  })

  it('clears the shipping selection when the cart changes', () => {
    useCartStore.setState({
      items: [{ productId: 'p', variantId: 'v', title: 'Colar', variantTitle: '', price: 7700, quantity: 1 }],
      selectedShipping: { tier: 'economico', label: 'Econômico', total: 3679, deliveryDays: 11, sellers: [] },
    })
    useCartStore.getState().updateQuantity('v', 2)
    expect(useCartStore.getState().selectedShipping).toBeNull()
  })
})
```

`app/checkout/__tests__/shipping-options.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ShippingOptions from '../ShippingOptions'
import type { ShippingQuote } from '@/lib/cart-store'

const seller = (id: string, name: string, service: 'PAC' | 'SEDEX', price: number) => ({
  sellerId: id, sellerName: name, tier: service === 'PAC' ? 'economico' as const : 'rapido' as const,
  service, serviceId: service === 'PAC' ? 1 : 2, price, deliveryDays: 9,
})
const twoSellers: ShippingQuote = {
  options: [
    { tier: 'economico', label: 'Econômico', total: 7410, deliveryDays: 14, sellers: [seller('a', 'Loja A', 'PAC', 3679), seller('b', 'Loja B', 'PAC', 3731)] },
    { tier: 'rapido', label: 'Rápido', total: 15140, deliveryDays: 7, sellers: [seller('a', 'Loja A', 'SEDEX', 7572), seller('b', 'Loja B', 'SEDEX', 7568)] },
  ],
  unavailableSellers: [],
}

describe('ShippingOptions', () => {
  it('shows Econômico and Rápido with total and delivery time, and selects on click', async () => {
    const onSelect = vi.fn()
    render(<ShippingOptions quote={twoSellers} selected={null} onSelect={onSelect} onRetry={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Econômico/ })).toBeInTheDocument()
    expect(screen.getByText('R$ 74,10')).toBeInTheDocument()
    expect(screen.getByText('chega em até 14 dias úteis')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Rápido/ }))
    expect(onSelect).toHaveBeenCalledWith(twoSellers.options[1])
  })

  it('explains that a multi-store order arrives in several packages, with per-store details', async () => {
    render(<ShippingOptions quote={twoSellers} selected={twoSellers.options[0]} onSelect={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText('Seu pedido sai de 2 lojas e chega em 2 pacotes separados.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ver detalhes' }))
    expect(screen.getByText('Loja A')).toBeInTheDocument()
    expect(screen.getByText('R$ 36,79')).toBeInTheDocument()
  })

  it('renders only the tiers that came back', () => {
    render(<ShippingOptions quote={{ ...twoSellers, options: [twoSellers.options[0]] }} selected={null} onSelect={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getAllByRole('radio')).toHaveLength(1)
  })

  it('blocks with a per-store message when a store cannot ship, and offers retry for quote failures', async () => {
    const onRetry = vi.fn()
    render(
      <ShippingOptions
        quote={{ options: [], unavailableSellers: [
          { sellerId: 'b', sellerName: 'Loja B', reason: 'missing_address', productTitles: ['Bolsa'] },
          { sellerId: 'c', sellerName: 'Loja C', reason: 'quote_failed', productTitles: ['Caneca'] },
          { sellerId: 'd', sellerName: 'Loja D', reason: 'oversized', productTitles: ['Balaio'] },
        ] }}
        selected={null} onSelect={vi.fn()} onRetry={onRetry}
      />
    )
    expect(screen.getByText(/Não foi possível calcular o frete para os produtos da loja Loja B/)).toBeInTheDocument()
    expect(screen.getByText(/O produto Balaio não pode ser enviado pelos Correios/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
```

`app/checkout/__tests__/page.test.ts` — substituir o último argumento de `createPreference` por `{ tier: 'economico', label: 'Econômico', total: 2500, deliveryDays: 11, sellers: [] }` e acrescentar:

```ts
  it('sends only the chosen tier and the total the buyer saw, never a per-service price', async () => {
    // ... mesma chamada
    expect(sentBody.shipping).toEqual({ tier: 'economico', expectedTotal: 2500 })
  })

  it('returns the new quote when the backend answers 409', async () => {
    const quote = { options: [], unavailableSellers: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'O valor do frete foi atualizado', quote }) }))
    const result = await createPreference(items, address, option)
    expect(result).toEqual({ ok: false, status: 409, error: 'O valor do frete foi atualizado', quote })
  })
```

(definir `items`, `address`, `option` como constantes no topo do arquivo reaproveitando os valores atuais.)

`checkout-test-cash.test.tsx` e `shipping-step.test.tsx`: no `stubBackend`, trocar a resposta de `/store/shipping/estimate` por `/store/shipping/quote` devolvendo um `ShippingQuote` com uma opção "Econômico" (uma loja, PAC 2500); em `fillAddressAndContinue`, clicar `screen.findByRole('radio', { name: /Econômico/ })`; seed do carrinho com `selectedShipping: null` e `version: 1`. Acrescentar em `checkout-test-cash.test.tsx`:

```tsx
  it('shows the updated price and keeps the buyer on the shipping step when the backend answers 409', async () => {
    // stub POST /store/checkout/sandbox-cash → { ok:false, status:409, json: { error, quote: <quote com Econômico 2900> } }
    // após clicar "Finalizar pedido (teste)":
    expect(await screen.findByText('O valor do frete foi atualizado para R$ 29,00. Confira e continue.')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/cart-store.test.ts src/app/checkout`
Expected: FAIL

- [ ] **Step 3: Implement**

`lib/cart-store.ts` — substituir `ShippingRate` por:

```ts
export type ShippingTier = 'economico' | 'rapido'

export type SellerShipping = {
  sellerId: string
  sellerName: string
  tier: ShippingTier
  service: 'PAC' | 'SEDEX'
  serviceId: number
  price: number
  deliveryDays: number
}

/** One choice the buyer sees: the sum of every store's PAC or SEDEX. */
export type ShippingOption = { tier: ShippingTier; label: string; total: number; deliveryDays: number; sellers: SellerShipping[] }

export type UnavailableSeller = {
  sellerId: string
  sellerName: string
  reason: 'missing_address' | 'oversized' | 'quote_failed'
  productTitles: string[]
}

export type ShippingQuote = { options: ShippingOption[]; unavailableSellers: UnavailableSeller[] }
```

e no store: `selectedShipping: ShippingOption | null`, `setShipping: (option: ShippingOption | null) => void`; em `addItem`, `removeItem` e `updateQuantity` acrescentar `selectedShipping: null` ao `set` (o carrinho mudou ⇒ recotar); `total` usa `selectedShipping?.total ?? 0`; na config do `persist`:

```ts
      version: 1,
      // v0 stored a single carrier rate ({ id, price, ... }). It cannot be
      // charged anymore, so the selection is dropped and the buyer re-quotes.
      migrate: (persisted: any, version) => (version < 1 ? { ...persisted, selectedShipping: null } : persisted),
```

`app/checkout/shipping-quote.ts`:

```ts
import type { ShippingQuote } from '@/lib/cart-store'
import { medusaBaseUrl } from '@/lib/medusa-url'

const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function fetchShippingQuote(
  postalCode: string,
  items: Array<{ variantId: string; quantity: number }>
): Promise<ShippingQuote> {
  const res = await fetch(`${medusaBaseUrl()}/store/shipping/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ postalCode, items }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Não foi possível calcular o frete.')
  }
  return res.json()
}
```

`app/checkout/create-preference.ts`:

```ts
import type { ShippingOption, ShippingQuote } from '@/lib/cart-store'
...
export type CheckoutResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; quote?: ShippingQuote }

export function buildCheckoutRequestBody(items: CheckoutItem[], address: Address, shipping: ShippingOption) {
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0) + shipping.total
  return { items, address, shipping: { tier: shipping.tier, expectedTotal: shipping.total }, total, document: address.document }
}

/** Shared by every checkout POST: maps 409/422 bodies into a typed failure. */
export async function readCheckoutResponse<T>(res: Response, pick: (body: any) => T): Promise<CheckoutResult<T>> {
  const body = await res.json().catch(() => ({}))
  if (res.ok) return { ok: true, data: pick(body) }
  return { ok: false, status: res.status, error: body?.error ?? 'Erro ao preparar o pagamento.', quote: body?.quote }
}

export async function createPreference(items: CheckoutItem[], address: Address, shipping: ShippingOption): Promise<CheckoutResult<PreferenceData>> {
  const res = await fetch(`${medusaBaseUrl()}/store/checkout/preference`, { /* igual ao atual */ body: JSON.stringify(buildCheckoutRequestBody(items, address, shipping)) })
  return readCheckoutResponse(res, (b) => ({ preferenceId: b.preference_id, externalReference: b.external_reference }))
}
```

`CheckoutItem.variantId` passa a `string` (obrigatório). `create-test-cash-order.ts`: mesma troca (`shipping: ShippingOption`, retorno `CheckoutResult<{ externalReference: string }>` via `readCheckoutResponse`, mantendo `try/catch` que devolve `{ ok: false, status: 0, error: 'Erro ao criar o pedido de teste.' }` em falha de rede).

`app/checkout/ShippingOptions.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { formatPrice } from '@/lib/api'
import type { ShippingOption, ShippingQuote, UnavailableSeller } from '@/lib/cart-store'

function unavailableMessage(u: UnavailableSeller): string {
  if (u.reason === 'oversized') {
    return `O produto ${u.productTitles.join(', ')} não pode ser enviado pelos Correios. Fale com a equipe do Mercado Preto.`
  }
  if (u.reason === 'quote_failed') {
    return `Não foi possível calcular o frete agora para os produtos da loja ${u.sellerName}.`
  }
  return `Não foi possível calcular o frete para os produtos da loja ${u.sellerName} (${u.productTitles.join(', ')}). Remova-os do carrinho para continuar.`
}

export default function ShippingOptions({
  quote, selected, onSelect, onRetry,
}: {
  quote: ShippingQuote
  selected: ShippingOption | null
  onSelect: (option: ShippingOption) => void
  onRetry: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)
  const storeCount = quote.options[0]?.sellers.length ?? 0

  if (quote.unavailableSellers.length > 0) {
    return (
      <div className="space-y-3" role="alert">
        {quote.unavailableSellers.map((u) => (
          <p key={u.sellerId} className="text-terracotta text-sm">{unavailableMessage(u)}</p>
        ))}
        {quote.unavailableSellers.some((u) => u.reason === 'quote_failed') && (
          <button type="button" onClick={onRetry} className="rounded-xl border border-sand-dark px-4 py-2 text-sm font-semibold">
            Tentar novamente
          </button>
        )}
      </div>
    )
  }

  if (quote.options.length === 0) {
    return <p className="text-onyx/50">Nenhuma opção de entrega disponível para este CEP.</p>
  }

  return (
    <div className="space-y-3">
      {quote.options.map((option) => (
        <label
          key={option.tier}
          className={`flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-colors ${
            selected?.tier === option.tier ? 'border-amber bg-amber/5' : 'border-sand-dark hover:border-amber/50'
          }`}
        >
          <input type="radio" name="shipping" checked={selected?.tier === option.tier} onChange={() => onSelect(option)} className="accent-amber" aria-label={option.label} />
          <div className="flex-1">
            <p className="font-semibold text-onyx">{option.label}</p>
            <p className="text-sm text-onyx/50">{`chega em até ${option.deliveryDays} dias úteis`}</p>
          </div>
          <p className="font-display font-bold text-onyx">{formatPrice(option.total)}</p>
        </label>
      ))}

      {storeCount > 1 && (
        <div className="text-sm text-onyx/60">
          <p>{`Seu pedido sai de ${storeCount} lojas e chega em ${storeCount} pacotes separados.`}</p>
          <button type="button" className="underline" onClick={() => setShowDetails((s) => !s)}>ver detalhes</button>
          {showDetails && selected && (
            <ul className="mt-2 space-y-1">
              {selected.sellers.map((s) => (
                <li key={s.sellerId} className="flex justify-between">
                  <span>{s.sellerName}</span>
                  <span>{formatPrice(s.price)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

`app/checkout/page.tsx`:
- trocar `rates`/`setRates` por `const [quote, setQuote] = useState<ShippingQuote | null>(null)`.
- `async function loadQuote()`: `const q = await fetchShippingQuote(address.cep.replace(/\D/g, ''), items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })))`; `setQuote(q)`; se `q.unavailableSellers.length === 0`, `setShipping(q.options.find((o) => o.tier === selectedShipping?.tier) ?? q.options[0] ?? null)`, senão `setShipping(null)`.
- `handleAddressSubmit` chama `loadQuote()` dentro do `try` existente (mantém a mensagem "Não foi possível calcular o frete..." no `catch`), depois `setStep('shipping')`.
- `handleShippingSubmit`: usar `result = await createTestCashOrder(...)` / `createPreference(...)`; se `!result.ok && result.status === 409 && result.quote`: `setQuote(result.quote)`, `const updated = result.quote.options.find((o) => o.tier === selectedShipping.tier) ?? null`, `setShipping(updated)`, `setError(updated ? \`O valor do frete foi atualizado para ${formatPrice(updated.total)}. Confira e continue.\` : result.error)`, `setLoading(false)`, `return`; se `!result.ok && result.status === 422 && result.quote`: `setQuote(result.quote)`, `setShipping(null)`, `setError(result.error)`, `return`; outros erros mantêm as mensagens atuais. Sucesso usa `result.data`.
- bloco "Frete": substituir a lista de `rates` por `{quote && <ShippingOptions quote={quote} selected={selectedShipping} onSelect={setShipping} onRetry={loadQuote} />}`; botão de avançar `disabled={loading || !selectedShipping || (quote?.unavailableSellers.length ?? 0) > 0}`.
- `totalCents = subtotal() + (selectedShipping?.total ?? 0)`; resumo: `<span>{\`Frete (${selectedShipping.label})\`}</span><span>{formatPrice(selectedShipping.total)}</span>`.
- remover o import de `fetchShippingRates` e `git rm apps/storefront/src/app/checkout/shipping-rates.ts`.

- [ ] **Step 4: Run tests**

Run: `cd apps/storefront && npx vitest run && ./node_modules/.bin/tsc --noEmit -p .`
Expected: PASS, sem erros de tipo

- [ ] **Step 5: Commit**

```bash
git add -A apps/storefront/src/lib apps/storefront/src/app/checkout
git commit -m "feat(checkout): oferecer frete econômico e rápido somando as lojas do carrinho"
```

---

### Task 11: Endereço no painel do lojista

**Files:**
- Create: `apps/storefront/src/lib/seller-address.ts`
- Test: `apps/storefront/src/lib/__tests__/seller-address.test.ts`
- Modify: `apps/storefront/src/lib/seller-store.ts` (tipo `SellerProfile` + 7 campos opcionais)
- Modify: `apps/storefront/src/app/painel/perfil/page.tsx`
- Modify: `apps/storefront/src/app/painel/layout.tsx`
- Test: `apps/storefront/src/app/painel/__tests__/address-banner.test.tsx`, `apps/storefront/src/app/painel/perfil/__tests__/address.test.tsx`

**Interfaces:**
- Consumes: `PATCH /seller/me` com endereço (Task 3)
- Produces: `hasShippingOrigin(seller)` (mesma regra do backend), `fetchAddressByCep(cep): Promise<{ street; district; city; state } | null>`

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/seller-address.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAddressByCep, hasShippingOrigin } from '../seller-address'

describe('hasShippingOrigin', () => {
  it('requires CEP, street, number, district, city and UF', () => {
    const full = { addressPostalCode: '44300000', addressStreet: 'Rua A', addressNumber: '1', addressDistrict: 'Centro', addressCity: 'Cachoeira', addressState: 'BA' }
    expect(hasShippingOrigin(full)).toBe(true)
    expect(hasShippingOrigin({ ...full, addressNumber: '' })).toBe(false)
    expect(hasShippingOrigin({})).toBe(false)
  })
})

describe('fetchAddressByCep', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps ViaCEP fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ logradouro: 'Rua Ana Nery', bairro: 'Centro', localidade: 'Cachoeira', uf: 'BA' }) }))
    expect(await fetchAddressByCep('44300-000')).toEqual({ street: 'Rua Ana Nery', district: 'Centro', city: 'Cachoeira', state: 'BA' })
    expect((fetch as any).mock.calls[0][0]).toBe('https://viacep.com.br/ws/44300000/json/')
  })

  it('returns null for unknown CEPs, short input and network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) }))
    expect(await fetchAddressByCep('00000000')).toBeNull()
    expect(await fetchAddressByCep('123')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await fetchAddressByCep('44300000')).toBeNull()
  })
})
```

`app/painel/__tests__/address-banner.test.tsx` — render do `PainelLayout` com `getMe` mockado (`vi.mock('@/lib/seller-api', ...)`) devolvendo um seller sem endereço → `expect(await screen.findByText('Complete seu endereço de envio para que seus produtos possam ser vendidos.')).toBeInTheDocument()` e o link "Completar endereço" com `href="/painel/perfil"`; com seller completo → `queryByText(...)` é `null`. `next/navigation` mockado com `usePathname: () => '/painel/dashboard'`.

`app/painel/perfil/__tests__/address.test.tsx` — `getMe` devolve seller sem endereço; `fetch` do ViaCEP stubado; digitar "44300000" no campo "CEP" e sair do campo (`user.tab()`) → os campos "Rua", "Bairro", "Cidade", "UF" ficam preenchidos; preencher "Número" = "12"; submeter → `patchMe` chamado com `expect.objectContaining({ addressPostalCode: '44300000', addressNumber: '12', addressCity: 'Cachoeira' })`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && npx vitest run src/lib/__tests__/seller-address.test.ts src/app/painel`
Expected: FAIL

- [ ] **Step 3: Implement**

`lib/seller-address.ts`:

```ts
// Mirrors hasShippingOrigin in the backend (utils/seller-address.ts), which is the authority.
export type SellerAddressFields = {
  addressPostalCode?: string | null
  addressStreet?: string | null
  addressNumber?: string | null
  addressComplement?: string | null
  addressDistrict?: string | null
  addressCity?: string | null
  addressState?: string | null
}

export function hasShippingOrigin(s: SellerAddressFields | null | undefined): boolean {
  if (!s) return false
  const filled = (v?: string | null) => !!v && v.trim().length > 0
  return (
    (s.addressPostalCode ?? '').replace(/\D/g, '').length === 8 &&
    filled(s.addressStreet) && filled(s.addressNumber) && filled(s.addressDistrict) &&
    filled(s.addressCity) && filled(s.addressState)
  )
}

export async function fetchAddressByCep(cep: string): Promise<{ street: string; district: string; city: string; state: string } | null> {
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.erro) return null
    return { street: data.logradouro ?? '', district: data.bairro ?? '', city: data.localidade ?? '', state: data.uf ?? '' }
  } catch {
    return null
  }
}
```

`lib/seller-store.ts`: `export type SellerProfile = { ...campos atuais } & SellerAddressFields` (import do tipo).

`app/painel/perfil/page.tsx`:
- `Form` ganha `addressPostalCode, addressStreet, addressNumber, addressComplement, addressDistrict, addressCity, addressState` (strings), inicializados de `getMe()`.
- Nova seção `<h2>Endereço de envio</h2>` com texto "De onde seus produtos saem. O frete é calculado a partir deste endereço." e campos com `<label htmlFor>`: CEP (com `onBlur` → `fetchAddressByCep` preenche rua/bairro/cidade/UF), Rua, Número, Complemento, Bairro, Cidade, UF.
- Se `!hasShippingOrigin(form)` mostrar aviso âmbar "Seus produtos não podem ser vendidos até o endereço de envio estar completo."
- `handleSubmit`: enviar `patchMe(form)` como hoje (os campos de endereço vão juntos). Quando os 7 campos estão todos vazios, removê-los do corpo antes de enviar (o backend trata o endereço como bloco único e recusaria um bloco vazio): `const body = hasAnyAddress(form) ? form : omitAddress(form)` com helpers locais.
- Após salvar, `updateSeller(data.seller)` atualiza o store e o aviso do layout some.

`app/painel/layout.tsx`: dentro de `<div className="flex-1 flex flex-col min-w-0">`, antes do conteúdo:

```tsx
        {!hasShippingOrigin(seller) && (
          <div className="bg-amber/10 border-b border-amber/30 px-6 py-3 text-sm text-onyx">
            Complete seu endereço de envio para que seus produtos possam ser vendidos.{' '}
            <Link href="/painel/perfil" className="font-semibold underline">Completar endereço</Link>
          </div>
        )}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/storefront && npx vitest run && ./node_modules/.bin/tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/lib apps/storefront/src/app/painel
git commit -m "feat(painel): permitir ao lojista cadastrar o endereço de envio"
```

---

### Task 12: Tamanho da embalagem nas telas de produto do lojista

**Files:**
- Create: `apps/storefront/src/lib/package-size.ts`
- Create: `apps/storefront/src/components/product/PackageSizeField.tsx`
- Modify: `apps/storefront/src/components/product/CategorySelect.tsx`
- Modify: `apps/storefront/src/app/painel/produtos/novo/page.tsx`, `apps/storefront/src/app/painel/produtos/[id]/page.tsx`
- Test: `apps/storefront/src/components/product/__tests__/PackageSizeField.test.tsx`, atualizar `CategorySelect.test.tsx`, `apps/storefront/src/app/painel/produtos/__tests__/package-size.test.tsx`

**Interfaces:**
- Consumes: `POST/PATCH /seller/products` com `packageSize`/`packageDimensions` (Task 8)
- Produces:
  - `lib/package-size.ts`: `PackageSize`, `PackageDimensions`, `PACKAGE_SIZE_OPTIONS: Array<{ value: PackageSize; label: string; hint: string }>`, `suggestPackageSize(categoryName?)`, `exceedsCorreiosLimits(d)` (mesmos valores do backend)
  - `CategorySelect` `onChange(categoryId: string, categoryName?: string)`
  - `<PackageSizeField value={{ size, dimensions }} onChange={(v) => ...} />` com `type PackageValue = { size: PackageSize; dimensions?: PackageDimensions }`

- [ ] **Step 1: Write the failing tests**

`components/product/__tests__/PackageSizeField.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import PackageSizeField, { type PackageValue } from '../PackageSizeField'

function Harness({ initial, onChange }: { initial: PackageValue; onChange: (v: PackageValue) => void }) {
  const [v, setV] = useState(initial)
  return <PackageSizeField value={v} onChange={(n) => { setV(n); onChange(n) }} />
}

describe('PackageSizeField', () => {
  it('offers the four sizes with examples', () => {
    render(<Harness initial={{ size: 'medium' }} onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Pequeno/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Médio/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Grande/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Volumoso/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Comprimento (cm)')).toBeNull()
  })

  it('asks for measures when Volumoso is chosen and reports them', async () => {
    const onChange = vi.fn()
    render(<Harness initial={{ size: 'medium' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: /Volumoso/ }))
    await userEvent.type(screen.getByLabelText('Comprimento (cm)'), '65')
    await userEvent.type(screen.getByLabelText('Largura (cm)'), '40')
    await userEvent.type(screen.getByLabelText('Altura (cm)'), '50')
    await userEvent.type(screen.getByLabelText('Peso (kg)'), '1,2')
    expect(onChange).toHaveBeenLastCalledWith({ size: 'bulky', dimensions: { length: 65, width: 40, height: 50, weight: 1.2 } })
  })

  it('warns when the measures exceed the Correios limits', async () => {
    render(<Harness initial={{ size: 'bulky', dimensions: { length: 120, width: 35, height: 115, weight: 1.8 } }} onChange={vi.fn()} />)
    expect(screen.getByText(/acima do limite dos Correios/)).toBeInTheDocument()
  })
})
```

`app/painel/produtos/__tests__/package-size.test.tsx` — página "novo": `vi.mock('@/lib/seller-api')`, `CategorySelect` real com `fetch` stubado devolvendo categorias `[{ id: 'cat-1', name: 'BRINCOS' }, { id: 'cat-2', name: 'DECORAÇÃO' }]`; ao escolher "BRINCOS" o radio "Pequeno" fica marcado; ao escolher "DECORAÇÃO" o radio "Volumoso" fica marcado; submeter com Volumoso + medidas → `createSellerProduct` recebe `expect.objectContaining({ packageSize: 'bulky', packageDimensions: { length: 65, width: 40, height: 50, weight: 1.2 } })`; submeter com Volumoso acima do limite → `createSellerProduct` não é chamado e aparece o erro.

`CategorySelect.test.tsx` — acrescentar: ao selecionar, `onChange` é chamado com `('cat-1', 'BRINCOS')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/storefront && npx vitest run src/components/product src/app/painel/produtos`
Expected: FAIL

- [ ] **Step 3: Implement**

`lib/package-size.ts`:

```ts
// UI mirror of the backend table (packages/medusa-backend/.../utils/package-size.ts),
// which validates and is the source of truth. Keep both in sync.
export type PackageSize = 'small' | 'medium' | 'large' | 'bulky'
export type PackageDimensions = { weight: number; length: number; width: number; height: number }

export const PACKAGE_SIZE_OPTIONS: Array<{ value: PackageSize; label: string; hint: string }> = [
  { value: 'small', label: 'Pequeno', hint: 'Até 0,3 kg, cabe numa caixa de sapato pequena — brincos, colares, pulseiras' },
  { value: 'medium', label: 'Médio', hint: 'Até 1 kg — bolsas, canecas, chapéus, roupas' },
  { value: 'large', label: 'Grande', hint: 'Até 3 kg — luminárias pequenas, kits' },
  { value: 'bulky', label: 'Volumoso', hint: 'Leve mas grande (palha, cipó, crochê) ou pesado: informe as medidas da caixa' },
]

const CATEGORY_SIZE: Record<string, PackageSize> = {
  BRINCOS: 'small', 'BRINCO AFRICANO': 'small', COLARES: 'small', PULSEIRAS: 'small', PINGENTE: 'small',
  BOLSAS: 'medium', 'CANECAS, COPOS E GARRAFAS': 'medium', CHAPEUS: 'medium', 'MODA AFRICANA': 'medium',
  'ROUPAS AFRO': 'medium', 'ROUPAS TRADICIONAIS': 'medium', PETISQUEIRAS: 'medium',
  'KITS PARA COZINHA': 'bulky', 'KITS PARA BANHEIROS': 'bulky', DECORACAO: 'bulky', LUMINARIAS: 'bulky',
  'KIT LUMINARIA': 'bulky', SACOLOES: 'bulky',
}

export function suggestPackageSize(categoryName?: string | null): PackageSize {
  if (!categoryName) return 'medium'
  const key = categoryName.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
  return CATEGORY_SIZE[key] ?? 'medium'
}

export function exceedsCorreiosLimits(d: PackageDimensions): boolean {
  const sides = [d.length, d.width, d.height]
  return Math.max(...sides) > 100 || sides.reduce((s, x) => s + x, 0) > 200 || d.weight > 30
}
```

`components/product/PackageSizeField.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { PACKAGE_SIZE_OPTIONS, exceedsCorreiosLimits, type PackageDimensions, type PackageSize } from '@/lib/package-size'

export type PackageValue = { size: PackageSize; dimensions?: PackageDimensions }

const FIELDS: Array<{ key: keyof PackageDimensions; label: string }> = [
  { key: 'length', label: 'Comprimento (cm)' },
  { key: 'width', label: 'Largura (cm)' },
  { key: 'height', label: 'Altura (cm)' },
  { key: 'weight', label: 'Peso (kg)' },
]

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'))
}

export default function PackageSizeField({ value, onChange }: { value: PackageValue; onChange: (v: PackageValue) => void }) {
  // Raw strings keep partial input like "1," while the seller is typing.
  const [raw, setRaw] = useState<Record<keyof PackageDimensions, string>>({
    length: value.dimensions?.length?.toString() ?? '',
    width: value.dimensions?.width?.toString() ?? '',
    height: value.dimensions?.height?.toString() ?? '',
    weight: value.dimensions?.weight?.toString().replace('.', ',') ?? '',
  })

  function setField(key: keyof PackageDimensions, text: string) {
    const next = { ...raw, [key]: text }
    setRaw(next)
    onChange({
      size: 'bulky',
      dimensions: { length: toNumber(next.length), width: toNumber(next.width), height: toNumber(next.height), weight: toNumber(next.weight) },
    })
  }

  const overLimit = value.size === 'bulky' && value.dimensions && exceedsCorreiosLimits(value.dimensions)

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-onyx">Tamanho da embalagem</legend>
      {PACKAGE_SIZE_OPTIONS.map((o) => (
        <label key={o.value} className="flex items-start gap-3 rounded-lg border border-sand-dark p-3 cursor-pointer">
          <input
            type="radio" name="packageSize" className="mt-1 accent-amber"
            checked={value.size === o.value}
            onChange={() => onChange(o.value === 'bulky' ? { size: 'bulky', dimensions: value.dimensions } : { size: o.value })}
            aria-label={o.label}
          />
          <span>
            <span className="font-semibold">{o.label}</span>
            <span className="block text-xs text-onyx/50">{o.hint}</span>
          </span>
        </label>
      ))}
      {value.size === 'bulky' && (
        <div className="grid grid-cols-2 gap-3 pt-2">
          <p className="col-span-2 text-xs text-onyx/60">
            Meça a caixa já fechada, com o produto dentro: comprimento, largura e altura com uma fita métrica, e pese numa balança de cozinha.
          </p>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`pkg-${f.key}`} className="text-xs font-semibold">{f.label}</label>
              <input id={`pkg-${f.key}`} inputMode="decimal" className="input" value={raw[f.key]} onChange={(e) => setField(f.key, e.target.value)} />
            </div>
          ))}
          {overLimit && (
            <p className="col-span-2 text-sm text-terracotta">
              Estas medidas estão acima do limite dos Correios (máx. 100 cm por lado, 200 cm somando os lados, 30 kg). Fale com a equipe do Mercado Preto.
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
```

`CategorySelect.tsx`: `onChange: (categoryId: string, categoryName?: string) => void` e no `<select>`: `onChange={(e) => onChange(e.target.value, categories.find((c) => c.id === e.target.value)?.name)}` (usar o nome da variável de estado de categorias já existente no componente).

`novo/page.tsx`:
- estado `const [pkg, setPkg] = useState<PackageValue>({ size: 'medium' })` e `const [pkgTouched, setPkgTouched] = useState(false)`.
- `CategorySelect onChange={(value, name) => { set('category_id', value); if (!pkgTouched) setPkg({ size: suggestPackageSize(name) }) }}` — a sugestão só vale enquanto o lojista não escolheu tamanho manualmente.
- `<PackageSizeField value={pkg} onChange={(v) => { setPkgTouched(true); setPkg(v) }} />` logo após a categoria.
- `handleSubmit`: se `pkg.size === 'bulky'` e (`!pkg.dimensions` ou algum valor ≤ 0 ou `NaN`) → `setError('Informe comprimento, largura, altura e peso da caixa.')` e `return`; se `exceedsCorreiosLimits` → `setError('Medidas acima do limite dos Correios.')` e `return`; enviar `packageSize: pkg.size` e, se bulky, `packageDimensions: pkg.dimensions`.

`[id]/page.tsx`: inicializar `pkg` a partir de `product.metadata?.package_size` (e, se `bulky`, das medidas da primeira variante); sem `package_size` (produto importado) iniciar com `{ size: 'medium' }` mas **não** enviar `packageSize` a menos que `pkgTouched` — assim produtos importados mantêm as medidas reais. Mesma validação do "novo".

- [ ] **Step 4: Run tests**

Run: `cd apps/storefront && npx vitest run && ./node_modules/.bin/tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/lib/package-size.ts apps/storefront/src/components/product apps/storefront/src/app/painel/produtos
git commit -m "feat(painel): escolher tamanho da embalagem no cadastro de produto"
```

---

### Task 13: Publicação no servidor de teste, dados provisórios e validação ponta a ponta

**Files:**
- Modify: `docs/DEPLOY_OCI.md` (seção "Atualizar após push": a migration do seller roda com o `db:migrate` já documentado — conferir que o passo está lá)
- Scratchpad (fora do repo): `/tmp/claude-1000/-home-lupontes-repos-marketplace/f1c68e07-f495-49bd-b097-7f8a920065e3/scratchpad/e2e_shipping.py`

**Interfaces:**
- Consumes: tudo acima; sandbox Mercado Pago (`card_one.py`/`keys.txt` do scratchpad); token sandbox Melhor Envio em `~/.melhorenvio-sandbox` (local)

- [ ] **Step 1: Suítes completas e build**

```bash
cd /home/lupontes/repos/marketplace-shipping/packages/medusa-backend/apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand
/home/lupontes/repos/marketplace-shipping/apps/storefront/node_modules/.bin/vitest run --config src/admin/vitest.config.ts
cd /home/lupontes/repos/marketplace-shipping/apps/storefront && npx vitest run && ./node_modules/.bin/tsc --noEmit -p .
```
Expected: tudo verde.

- [ ] **Step 2: Push e deploy da branch no servidor de teste**

```bash
cd /home/lupontes/repos/marketplace-shipping && git push -u origin feature/shipping-per-seller
ssh ubuntu@168.138.148.67 'cd ~/marketplace && git fetch -q && git checkout -q feature/shipping-per-seller && git pull -q --ff-only && \
  docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci build medusa && \
  docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci run --rm medusa npx medusa db:migrate && \
  docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d medusa'
```

- [ ] **Step 3: Token do sandbox no servidor (sem expor o valor)**

Fazer backup de `infra/.env.oci` e gravar `MELHOR_ENVIO_TOKEN` a partir do arquivo local, via stdin (o token não aparece em linha de comando nem em log):

```bash
ssh ubuntu@168.138.148.67 'cd ~/marketplace && cp infra/.env.oci infra/.env.oci.bak-$(date +%Y%m%d%H%M%S) && sed -i "/^MELHOR_ENVIO_ORIGIN_CEP=/d" infra/.env.oci'
cut -d= -f2- ~/.melhorenvio-sandbox | ssh ubuntu@168.138.148.67 'cd ~/marketplace && T=$(cat) && grep -v "^MELHOR_ENVIO_TOKEN=" infra/.env.oci > /tmp/envoci && printf "MELHOR_ENVIO_TOKEN=%s\n" "$T" >> /tmp/envoci && mv /tmp/envoci infra/.env.oci && chmod 600 infra/.env.oci && grep -c "^MELHOR_ENVIO_TOKEN=." infra/.env.oci'
ssh ubuntu@168.138.148.67 'cd ~/marketplace && docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d medusa'
```
Expected: `1`.

- [ ] **Step 4: Dados provisórios (autorizados para o ambiente de teste)**

```bash
ssh ubuntu@168.138.148.67 "docker exec mercado-preto-db psql -U medusa -d mercado_preto -c \"
update seller set \\\"addressPostalCode\\\"='44300000', \\\"addressStreet\\\"='Rua Sete de Setembro', \\\"addressNumber\\\"='S/N',
  \\\"addressDistrict\\\"='Centro Histórico', \\\"addressCity\\\"='Cachoeira', \\\"addressState\\\"='BA'
  where deleted_at is null and (location ilike '%Cachoeira%' or location ilike '%Cahoeira%');
select id, name, \\\"addressPostalCode\\\" from seller where deleted_at is null;\""
```

Listar as variantes fora do limite (guardar a lista para o relatório ao usuário), depois aplicar medidas provisórias e marcar revisão:

```bash
ssh ubuntu@168.138.148.67 "docker exec mercado-preto-db psql -U medusa -d mercado_preto -At -F'|' -c \"
select p.id, p.title, pv.length, pv.width, pv.height, pv.weight from product_variant pv join product p on p.id=pv.product_id
 where pv.deleted_at is null and (greatest(pv.length,pv.width,pv.height)>100 or pv.length+pv.width+pv.height>200 or pv.weight>30);\" -c \"
update product set metadata = coalesce(metadata,'{}'::jsonb) || '{\\\"package_review\\\":\\\"pending\\\"}'::jsonb
 where id in (select product_id from product_variant where deleted_at is null and (greatest(length,width,height)>100 or length+width+height>200 or weight>30));
update product_variant set length=least(length,60), width=least(width,60), height=least(height,60), weight=least(weight,30)
 where deleted_at is null and (greatest(length,width,height)>100 or length+width+height>200 or weight>30);\""
```

- [ ] **Step 5: Validação ponta a ponta (scratchpad)**

Criar `e2e_shipping.py` que, com a publishable key de `keys.txt`:
1. escolhe 1 variante publicada da loja oficial (com endereço) e 1 da outra loja (sem endereço) via `GET /store/products?fields=variants.id,...`;
2. `POST /store/shipping/quote` com a variante da loja **sem endereço** → espera `unavailableSellers[0].reason == "missing_address"`;
3. grava endereço provisório na segunda loja (Salvador, CEP 40026010, autorizado) via SQL e repete com as duas variantes → espera duas opções, cada uma com 2 `sellers`, totais = soma;
4. cria preferência com `shipping: { tier: "economico", expectedTotal }` → 200; com `expectedTotal` errado → 409 com `quote`;
5. paga com cartão APRO (reaproveitar a função de `card_one.py`) → aguarda o webhook e confere no banco: 2 pedidos, `shipping_methods.name = 'Correios PAC'`, valores = preço PAC de cada loja, `metadata->>'shipping_service_id' = '1'`, `metadata->>'shipping_status' = 'awaiting_shipment'`.

Run: `python3 -I e2e_shipping.py keys.txt`
Expected: todas as verificações "OK".

- [ ] **Step 6: Storefront no servidor**

```bash
ssh ubuntu@168.138.148.67 'source ~/.nvm/nvm.sh >/dev/null && nvm use 22 >/dev/null && cd ~/marketplace/apps/storefront && pnpm install --frozen-lockfile && pnpm build && pm2 restart storefront && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" https://teste.mercadopreto.com.br/checkout'
```
Expected: `200`.

- [ ] **Step 7: Commit de documentação (se houve ajuste) e PR**

```bash
git add docs/DEPLOY_OCI.md && git commit -m "docs(deploy): documentar token sandbox do melhor envio no ambiente de teste" || true
gh pr create --base develop --head feature/shipping-per-seller --title "feat(frete): frete por loja com opções econômico e rápido" --body "<resumo + validação ponta a ponta + lista das variantes ajustadas provisoriamente>"
```

---

## Self-Review

- **Cobertura do spec:**
  - 1.1 endereço → Tasks 2, 3, 9, 11
  - 1.2 embalagem → Tasks 1, 8, 9, 12
  - 2 cotação → Tasks 4, 5, 6
  - 3 checkout → Task 10
  - 4 pagamento e pedidos → Task 7
  - 5 erros → Tasks 4 (timeout, HTTP), 5 (quote_failed, sem token), 6 (400), 7 (409/422), 10 (mensagens)
  - Dados a preparar → Task 13
  - Remoção da rota antiga e de `MELHOR_ENVIO_ORIGIN_CEP` → Task 6
- **Tipos:**
  - `ShippingOption`, `SellerShipping` e `UnavailableSeller` são idênticos entre backend (Task 5) e storefront (Task 10).
  - `buildCheckoutSnapshot(query, request, option)` é usado pelas Tasks 7 e 13.
  - `resolveCheckoutShipping` retorna `{ ok, option } | { ok:false, status, body }` e é consumido nas rotas da Task 7.
  - `PackageValue` é usado igual nas Tasks 12 (campo e páginas).
- **Ressalva conhecida:**
  - O `transaction_amount` da rota `/store/checkout/payment` (Brick) continua vindo do navegador. Isso é tratado no próximo ciclo (preço dos itens), por decisão registrada no spec.
  - O valor exibido e o total da preferência já usam o frete do servidor.
