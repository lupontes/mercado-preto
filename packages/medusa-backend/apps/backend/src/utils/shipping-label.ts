import { CartRequest, LabelClient, LabelVolume, MelhorEnvioError } from "./melhor-envio-labels"
import type { QuoteProduct, ShippingCalculator } from "./melhor-envio"
import { PACKAGE_SIZES, variantDimensionsOrDefault } from "./package-size"
import { normalizePostalCode } from "./seller-address"
import { buildCartRequest, LabelOrder, LabelSeller } from "./shipping-label-payload"
import { handlingDaysFromEnv } from "./shipping-quote"

export type ShippingLabelStatus = "pending" | "generated" | "failed" | "canceled"

export type ShippingLabelState = {
  status: ShippingLabelStatus
  meOrderIds: string[]
  /** Sum of the cart prices, in cents. */
  price: number | null
  trackingCode: string | null
  generatedAt: string | null
  postBy: string | null
  reminderSentAt: string | null
  error: string | null
  /** True once checkout succeeded: the label is paid and must never be checked out again. */
  paid: boolean
  /** ISO time the state entered `pending`; lets a later task spot a stale pending. */
  pendingSince: string | null
}

export type PurchaseDeps = {
  orderService: { retrieveOrder: (id: string, config?: any) => Promise<any>; updateOrders: (id: string, data: any) => Promise<any> }
  sellerService: { retrieveSeller: (id: string) => Promise<any> }
  labels: LabelClient
  calculator: ShippingCalculator
  /** Optional: gives the re-quote the real variant dimensions; without it items count as medium. */
  query?: { graph: (args: any) => Promise<{ data: any[] }> }
  now?: () => Date
  handlingDays?: number
}

/** Skips Saturday and Sunday; works on UTC days like the ISO timestamps we store. */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from)
  let remaining = days
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    const weekday = result.getUTCDay()
    if (weekday !== 0 && weekday !== 6) remaining--
  }
  return result
}

export function labelsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MELHOR_ENVIO_LABELS_ENABLED === "true"
}

const emptyState = (): ShippingLabelState => ({
  status: "pending", meOrderIds: [], price: null, trackingCode: null,
  generatedAt: null, postBy: null, reminderSentAt: null, error: null, paid: false, pendingSince: null,
})

// The backend runs as a single process, so this closes the window between
// reading `pending` and persisting it; the persisted state covers later calls.
const inFlight = new Map<string, Promise<ShippingLabelState | StaleResumeConflict>>()

export function purchaseShippingLabel(deps: PurchaseDeps, orderId: string): Promise<ShippingLabelState> {
  const running = inFlight.get(orderId)
  // Only another purchase can hold the lock here; a resume is also a purchase.
  if (running) return running as Promise<ShippingLabelState>
  const promise = run(deps, orderId).finally(() => inFlight.delete(orderId))
  inFlight.set(orderId, promise)
  return promise as Promise<ShippingLabelState>
}

export type StaleResumeConflict = { conflict: string }

/**
 * Recovers a purchase whose process died, under the same lock as
 * purchaseShippingLabel. The order is re-read inside the lock so a concurrent
 * request that already reset or finished the purchase is never overwritten.
 */
export function resumeStalePurchase(
  deps: PurchaseDeps,
  orderId: string,
  staleAfterMs = 15 * 60 * 1000
): Promise<ShippingLabelState | StaleResumeConflict> {
  if (inFlight.has(orderId)) {
    return Promise.resolve({ conflict: "Já existe uma compra de etiqueta em andamento para este pedido" })
  }
  const promise = run(deps, orderId, staleAfterMs).finally(() => inFlight.delete(orderId))
  inFlight.set(orderId, promise)
  return promise
}

/** An error whose Portuguese message is safe to store as-is. */
class LabelPurchaseError extends Error {}

/**
 * A 422 from Melhor Envio says only "invalid data" in `message`; the actual
 * cause is in `errors` (field -> messages), so both are kept, one message per field.
 */
function melhorEnvioDetail(parsed: any): string {
  const parts: string[] = []
  if (typeof parsed?.message === "string") parts.push(parsed.message)
  else if (typeof parsed?.error === "string") parts.push(parsed.error)

  if (parsed?.errors && typeof parsed.errors === "object") {
    const fields = Object.entries(parsed.errors)
      .map(([field, messages]) => {
        const first = Array.isArray(messages) ? messages.find((m) => typeof m === "string") : messages
        return typeof first === "string" ? `${field}: ${first}` : null
      })
      .filter((f): f is string => f !== null)
    if (fields.length > 0) parts.push(`(${fields.join("; ")})`)
  }
  return parts.join(" ")
}

function describeError(err: unknown): string {
  if (err instanceof LabelPurchaseError) return err.message
  if (err instanceof MelhorEnvioError) {
    let detail = ""
    try {
      detail = melhorEnvioDetail(JSON.parse(err.body))
    } catch {
      detail = ""
    }
    return `Melhor Envio: ${err.status}${detail ? ` ${detail.slice(0, 500)}` : ""}`
  }
  // Raw messages of unknown errors could echo request headers, so they are not stored.
  return "Falha inesperada ao comprar a etiqueta"
}

async function run(deps: PurchaseDeps, orderId: string, recoverStaleAfterMs?: number): Promise<ShippingLabelState | StaleResumeConflict> {
  const { orderService } = deps
  const order = await orderService.retrieveOrder(orderId, {
    relations: ["items", "shipping_address"],
    select: ["metadata", "display_id", "email"],
  })
  const metadata = order.metadata ?? {}
  let existing: ShippingLabelState | undefined = metadata.shipping_label

  if (recoverStaleAfterMs !== undefined) {
    const nowMs = (deps.now ?? (() => new Date()))().getTime()
    const stale =
      existing?.status === "pending" &&
      !!existing.pendingSince &&
      nowMs - new Date(existing.pendingSince).getTime() > recoverStaleAfterMs
    if (!existing || !stale) return { conflict: "A etiqueta não está mais com a compra interrompida" }
    // Keeps ids/paid/price so the resume below never pays twice.
    existing = { ...existing, status: "failed", pendingSince: null, error: "Compra interrompida; retomada pelo painel" }
    await orderService.updateOrders(orderId, { metadata: { ...metadata, shipping_label: { ...existing, meOrderIds: [...(existing.meOrderIds ?? [])] } } })
  }

  if (existing && (existing.status === "pending" || existing.status === "generated")) return existing

  const save = async (state: ShippingLabelState) => {
    // Medusa replaces metadata wholesale, so the full object always goes back.
    await orderService.updateOrders(orderId, { metadata: { ...metadata, shipping_label: { ...state, meOrderIds: [...state.meOrderIds] } } })
    return state
  }

  const now = deps.now ?? (() => new Date())
  // A retry resumes from what was already obtained/paid instead of starting over,
  // so a paid label is never bought twice.
  const state: ShippingLabelState = {
    ...emptyState(),
    ...(existing?.status === "failed" ? { meOrderIds: [...(existing.meOrderIds ?? [])], price: existing.price ?? null, paid: existing.paid === true } : {}),
    status: "pending",
    pendingSince: now().toISOString(),
  }
  await save(state)

  try {
    const sellerRecord = await deps.sellerService.retrieveSeller(String(metadata.seller_id))
    const addr = order.shipping_address ?? {}
    const labelOrder: LabelOrder = {
      displayId: order.display_id,
      serviceId: Number(metadata.shipping_service_id),
      email: order.email,
      buyerDocument: metadata.buyer_document ?? null,
      address: {
        firstName: addr.first_name ?? "", lastName: addr.last_name ?? "", phone: addr.phone ?? "",
        street: addr.address_1 ?? "", number: metadata.address_number ?? null, complement: addr.address_2 ?? "",
        district: metadata.address_district ?? null, city: addr.city ?? "", state: addr.province ?? "",
        postalCode: addr.postal_code ?? "",
      },
      items: (order.items ?? []).map((i: any) => ({ title: i.title, quantity: i.quantity, unitPrice: Number(i.unit_price) })),
    }
    const labelSeller: LabelSeller = {
      name: sellerRecord.name, phone: sellerRecord.phone, email: sellerRecord.email, cpfCnpj: sellerRecord.cpfCnpj,
      address: {
        postalCode: sellerRecord.addressPostalCode, street: sellerRecord.addressStreet, number: sellerRecord.addressNumber,
        complement: sellerRecord.addressComplement, district: sellerRecord.addressDistrict,
        city: sellerRecord.addressCity, state: sellerRecord.addressState,
      },
    }

    if (state.meOrderIds.length === 0) {
      const volumes = await resolveVolumes(deps, order, labelOrder, sellerRecord)
      // Build every request before the first Melhor Envio call, so a bad order never leaves a half-filled cart.
      const bodies: CartRequest[] = []
      for (const volume of volumes) {
        const built = buildCartRequest(labelOrder, labelSeller, volume)
        if (!built.ok) return save({ ...state, status: "failed", error: built.reason })
        bodies.push(built.body)
      }

      let price = 0
      state.price = 0
      for (const body of bodies) {
        try {
          const added = await deps.labels.addToCart(body)
          state.meOrderIds.push(added.id)
          price += added.price
          state.price = price
        } catch (err) {
          return save({ ...state, status: "failed", error: describeError(err) })
        }
      }
    }
    if (!state.paid) {
      await deps.labels.checkout(state.meOrderIds)
      state.paid = true
      await save(state)
    }
    await deps.labels.generate(state.meOrderIds)

    const generatedAt = now()
    const handlingDays = deps.handlingDays ?? handlingDaysFromEnv()
    return await save({
      ...state, status: "generated", error: null,
      generatedAt: generatedAt.toISOString(), postBy: addBusinessDays(generatedAt, handlingDays).toISOString(),
    })
  } catch (err) {
    return save({ ...state, status: "failed", error: describeError(err) })
  }
}

async function resolveVolumes(deps: PurchaseDeps, order: any, labelOrder: LabelOrder, seller: any): Promise<LabelVolume[]> {
  const items: any[] = order.items ?? []
  const variantIds = items.map((i) => i.variant_id).filter(Boolean)
  let variants: any[] = []
  if (deps.query && variantIds.length > 0) {
    const res = await deps.query.graph({
      entity: "product_variant",
      fields: ["id", "weight", "length", "width", "height"],
      filters: { id: variantIds },
    })
    variants = res.data
  }
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const products: QuoteProduct[] = items.map((i) => ({
    id: i.variant_id ?? i.id,
    ...variantDimensionsOrDefault(variantById.get(i.variant_id) ?? {}),
    insuranceValue: Number(i.unit_price),
    quantity: i.quantity,
  }))
  const quotes = await deps.calculator({
    fromPostalCode: normalizePostalCode(seller.addressPostalCode ?? ""),
    toPostalCode: normalizePostalCode(labelOrder.address.postalCode),
    products,
  })
  const quote = quotes.find((q) => q.serviceId === labelOrder.serviceId)
  if (!quote) throw new LabelPurchaseError("Serviço de frete escolhido indisponível na nova cotação")
  return quote.packages && quote.packages.length > 0 ? quote.packages : [PACKAGE_SIZES.medium]
}
