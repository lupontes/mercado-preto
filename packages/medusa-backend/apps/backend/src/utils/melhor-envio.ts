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

/** One physical volume Melhor Envio plans for a quote (weight in kg, dimensions in cm). */
export type LabelVolume = { weight: number; length: number; width: number; height: number }

export type ServiceQuote = {
  service: "PAC" | "SEDEX"
  serviceId: number
  price: number
  deliveryDays: number
  /** Volumes Melhor Envio planned for this quote; absent when the response omits them. */
  packages?: LabelVolume[]
}

export type ShippingCalculator = (input: {
  fromPostalCode: string
  toPostalCode: string
  products: QuoteProduct[]
}) => Promise<ServiceQuote[]>

// Melhor Envio service ids for Correios. Only Correios is offered: it has an
// agency in nearly every town, which matters for first-time sellers.
const CORREIOS_SERVICES = "1,2"

// Number(null) and Number("") are 0, which would look like a valid deadline.
function toNumberOrNaN(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN
  return Number(value)
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

function toVolume(p: any): LabelVolume {
  return {
    weight: Number(p.weight),
    length: Number(p.dimensions?.length),
    width: Number(p.dimensions?.width),
    height: Number(p.dimensions?.height),
  }
}

function isValidVolume(v: LabelVolume): boolean {
  return [v.weight, v.length, v.width, v.height].every(isPositive)
}

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
          deliveryDays: toNumberOrNaN(s.custom_delivery_time ?? s.delivery_time),
          // Invalid measures would make the label purchase fail, so the quote carries no packages
          // and the purchase falls back to the medium size.
          ...(Array.isArray(s.packages) && s.packages.length > 0 && s.packages.map(toVolume).every(isValidVolume)
            ? { packages: s.packages.map(toVolume) }
            : {}),
        }))
        // A service without a usable price or deadline would surface as
        // "R$ NaN" / "null dias" in the checkout, so it is treated as unavailable.
        .filter((q) => Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.deliveryDays) && q.deliveryDays >= 0)
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
  // A stray space or newline from a copied .env value must not become "Bearer tok\n".
  const token = env.MELHOR_ENVIO_TOKEN?.trim()
  if (token) {
    return createMelhorEnvioCalculator({
      token,
      // Mirrors isSandboxMode() in utils/sandbox.ts without reading the global process.env.
      sandbox: env.MARKETPLACE_SANDBOX !== "false",
    })
  }
  return env.NODE_ENV === "development" ? mockShippingCalculator : null
}
