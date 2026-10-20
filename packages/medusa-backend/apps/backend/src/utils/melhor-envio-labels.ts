import type { LabelVolume } from "./melhor-envio"

export type { LabelVolume }
export type CartRequest = Record<string, unknown>
export type TrackingInfo = {
  status: string
  trackingCode: string | null
  postedAt: string | null
  deliveredAt: string | null
}

export type LabelClient = {
  /** Returns the Melhor Envio label id and its price in cents. */
  addToCart(body: CartRequest): Promise<{ id: string; price: number }>
  checkout(ids: string[]): Promise<void>
  generate(ids: string[]): Promise<void>
  printUrl(ids: string[]): Promise<string>
  tracking(ids: string[]): Promise<Record<string, TrackingInfo>>
  cancel(id: string): Promise<void>
}

export class MelhorEnvioError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    // The message carries only status and body: the token lives in a header and must never be echoed.
    super(`Melhor Envio respondeu ${status}: ${body}`)
    this.name = "MelhorEnvioError"
  }
}

// Melhor Envio cancellation reason "2" is the generic "customer gave up" reason.
const CANCEL_REASON_ID = "2"

export function createLabelClient(opts: {
  token: string
  sandbox: boolean
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): LabelClient {
  const baseUrl = opts.sandbox ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br"
  const doFetch = opts.fetchImpl ?? fetch

  async function post(path: string, payload: unknown): Promise<{ data: any; raw: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000)
    try {
      const res = await doFetch(`${baseUrl}/api/v2${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mercado Preto (contato@mercadopreto.com.br)",
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new MelhorEnvioError(res.status, await res.text().catch(() => ""))
      const raw = await res.text().catch(() => "")
      let data: any = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        // A non-JSON success body is handled by the callers' required-field checks.
      }
      return { data, raw }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async addToCart(body) {
      const { data, raw } = await post("/me/cart", body)
      // "undefined" must never become a label id that is later paid for.
      if (data?.id == null || data.id === "") throw new MelhorEnvioError(200, raw)
      return { id: String(data.id), price: Math.round(Number(data.price) * 100) }
    },
    async checkout(ids) {
      await post("/me/shipment/checkout", { orders: ids })
    },
    async generate(ids) {
      await post("/me/shipment/generate", { orders: ids })
    },
    async printUrl(ids) {
      // Public mode: a private link only opens for someone logged into the platform's Melhor Envio account.
      const { data, raw } = await post("/me/shipment/print", { mode: "public", orders: ids })
      if (typeof data?.url !== "string" || data.url === "") throw new MelhorEnvioError(200, raw)
      return data.url
    },
    async tracking(ids) {
      const { data } = await post("/me/shipment/tracking", { orders: ids })
      const result: Record<string, TrackingInfo> = {}
      for (const [id, t] of Object.entries<any>(data ?? {})) {
        result[id] = {
          status: String(t?.status ?? ""),
          trackingCode: t?.tracking ?? null,
          postedAt: t?.posted_at ?? null,
          deliveredAt: t?.delivered_at ?? null,
        }
      }
      return result
    },
    async cancel(id) {
      await post("/me/shipment/cancel", { order: { id, reason_id: CANCEL_REASON_ID, description: "Pedido cancelado" } })
    },
  }
}

export function getLabelClient(env: NodeJS.ProcessEnv = process.env): LabelClient | null {
  // A stray space or newline from a copied .env value must not become "Bearer tok\n".
  const token = env.MELHOR_ENVIO_TOKEN?.trim()
  if (!token) return null
  // Mirrors isSandboxMode() in utils/sandbox.ts without reading the global process.env.
  return createLabelClient({ token, sandbox: env.MARKETPLACE_SANDBOX !== "false" })
}
