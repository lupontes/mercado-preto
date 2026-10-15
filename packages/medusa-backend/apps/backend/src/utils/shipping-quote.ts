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
