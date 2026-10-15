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
): Promise<{ ok: true; option: ShippingOption } | { ok: false; status: 400 | 409 | 422; body: Record<string, unknown> }> {
  let quote: Awaited<ReturnType<typeof quoteShipping>>
  try {
    quote = await quoteShipping(deps, {
      postalCode: request.address.cep,
      items: request.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    })
  } catch (err) {
    // Unknown variant / seller-less product (stale cart): same 400 as /store/shipping/quote.
    return { ok: false, status: 400, body: { error: err instanceof Error ? err.message : String(err) } }
  }

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
