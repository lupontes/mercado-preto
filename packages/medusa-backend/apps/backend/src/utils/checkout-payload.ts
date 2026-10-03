import { z } from "zod"
import { validateDocument } from "./validate-document"
import { groupItemsBySeller, type SellerGroup } from "./seller-order-groups"
import type { CheckoutMeta } from "./create-orders-from-checkout"

// Shared by every checkout entry point (MercadoPago preference, test cash) so
// they validate and persist exactly the same shape.
export const checkoutRequestSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      quantity: z.number().int().positive(),
      price: z.number().int().positive(),
      variantId: z.string().optional(),
      productId: z.string(),
    })
  ).min(1),
  address: z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email(),
    phone: z.string().optional(),
    cep: z.string(),
    address1: z.string(),
    address2: z.string().optional(),
    city: z.string(),
    state: z.string(),
  }),
  shipping: z.object({
    id: z.string(),
    name: z.string(),
    price: z.number().int().nonnegative(),
  }),
  total: z.number().int().positive(),
  document: z.string().refine((v) => validateDocument(v).valid, {
    message: "CPF ou CNPJ inválido",
  }),
})

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export type CheckoutSnapshotPayload = CheckoutMeta & {
  seller_groups: SellerGroup[]
  buyer_document: string
  address: Record<string, string>
  items: SellerGroup["items"]
  shipping: { id: string; name: string; price: number }
  total: number
}

type ProductQuery = { graph: (args: any) => Promise<{ data: any[] }> }

export async function buildCheckoutSnapshot(
  query: ProductQuery,
  request: CheckoutRequest
): Promise<{ payload: CheckoutSnapshotPayload } | { unresolvedProductId: string }> {
  const { items, address, shipping, total, document } = request
  // checkoutRequestSchema already rejected invalid documents, so digits is set.
  const buyerDocument = validateDocument(document).digits as string

  const productIds = [...new Set(items.map((i) => i.productId))]
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "seller.id"],
    filters: { id: productIds },
  })
  const sellerByProductId: Record<string, string> = {}
  for (const p of products as any[]) {
    if (p.seller?.id) sellerByProductId[p.id] = p.seller.id
  }

  const grouped = groupItemsBySeller(items, sellerByProductId, shipping.price)
  if ("unresolvedProductId" in grouped) {
    return { unresolvedProductId: grouped.unresolvedProductId }
  }

  return {
    payload: {
      seller_groups: grouped.groups,
      buyer_document: buyerDocument,
      address: {
        first_name: address.firstName,
        last_name: address.lastName,
        email: address.email,
        phone: address.phone ?? "",
        address_1: address.address1,
        address_2: address.address2 ?? "",
        city: address.city,
        state: address.state,
        postal_code: address.cep.replace(/\D/g, ""),
      },
      items: items.map((i) => ({
        variant_id: i.variantId,
        title: i.title,
        quantity: i.quantity,
        price: i.price,
      })),
      shipping: { id: shipping.id, name: shipping.name, price: shipping.price },
      total,
    },
  }
}
