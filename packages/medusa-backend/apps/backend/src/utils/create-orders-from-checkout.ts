import { Modules } from "@medusajs/framework/utils"
import type { SellerGroup } from "./seller-order-groups"

export type CheckoutMeta = {
  seller_groups?: SellerGroup[]
  seller_id?: string
  items?: SellerGroup["items"]
  shipping?: { id?: string; name: string; price: number }
  address?: Record<string, string>
  buyer_document?: string
}

type CreateOrdersFromCheckoutArgs = {
  container: { resolve: (key: string) => any }
  externalReference: string
  meta: CheckoutMeta
  extraMetadata?: Record<string, unknown>
  // MercadoPago payer data, used by the webhook only when the snapshot lacks an address.
  fallbackPayer?: Record<string, any>
}

/**
 * Creates one order per seller group of a checkout. Idempotent per
 * (externalReference, seller): groups that already have an order are skipped,
 * so retried webhooks never duplicate orders. Callers emit the events, since
 * which events fire depends on how the checkout was paid.
 */
export async function createOrdersFromCheckout({
  container,
  externalReference,
  meta,
  extraMetadata = {},
  fallbackPayer,
}: CreateOrdersFromCheckoutArgs): Promise<Array<{ id: string }>> {
  const addr = meta.address
  const shipping = meta.shipping

  const sellerGroups: SellerGroup[] = Array.isArray(meta.seller_groups)
    ? meta.seller_groups
    : [
        {
          sellerId: meta.seller_id,
          subtotal: 0,
          shippingShare: shipping?.price ?? 0,
          items: meta.items ?? [],
        } as SellerGroup,
      ]

  const orderService = container.resolve(Modules.ORDER)

  const pendingGroups: SellerGroup[] = []
  for (const group of sellerGroups) {
    const existing = await orderService.listOrders(
      { metadata: { mercadopago_external_reference: externalReference, seller_id: group.sellerId } } as any,
      { take: 1 }
    )
    if (existing.length === 0) pendingGroups.push(group)
  }

  if (pendingGroups.length === 0) return []

  return orderService.createOrders(
    pendingGroups.map((group) => ({
      currency_code: "brl",
      email: addr?.email ?? fallbackPayer?.email,
      shipping_address: {
        first_name: addr?.first_name ?? fallbackPayer?.name ?? "",
        last_name: addr?.last_name ?? fallbackPayer?.surname ?? "",
        phone: addr?.phone ?? fallbackPayer?.phone?.number ?? "",
        address_1: addr?.address_1 ?? fallbackPayer?.address?.street_name ?? "",
        address_2: addr?.address_2 ?? "",
        city: addr?.city ?? "",
        province: addr?.state ?? "",
        country_code: "br",
        postal_code: addr?.postal_code ?? fallbackPayer?.address?.zip_code ?? "",
      },
      items: group.items.map((i) => ({
        title: i.title,
        quantity: i.quantity,
        unit_price: i.price,
        ...(i.variant_id ? { variant_id: i.variant_id } : {}),
      })),
      shipping_methods: shipping ? [{ name: shipping.name, amount: group.shippingShare }] : [],
      metadata: {
        mercadopago_external_reference: externalReference,
        seller_id: group.sellerId,
        buyer_document: meta.buyer_document,
        ...extraMetadata,
      },
    }))
  )
}
