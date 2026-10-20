import type { CartRequest, LabelVolume } from "./melhor-envio-labels"
import { hasShippingOrigin } from "./seller-address"

export type LabelOrder = {
  displayId: number
  serviceId: number
  email: string
  buyerDocument: string | null
  address: {
    firstName: string
    lastName: string
    phone: string
    street: string
    number: string | null
    complement: string
    district: string | null
    city: string
    state: string
    postalCode: string
  }
  /** unitPrice is in cents. */
  items: Array<{ title: string; quantity: number; unitPrice: number }>
}

export type LabelSeller = {
  name: string
  phone: string
  email: string
  cpfCnpj: string
  address: {
    postalCode: string | null
    street: string | null
    number: string | null
    complement: string | null
    district: string | null
    city: string | null
    state: string | null
  }
}

const digits = (v: string) => v.replace(/\D/g, "")
const filled = (v: string | null | undefined): v is string => typeof v === "string" && v.trim().length > 0

export function buildCartRequest(
  order: LabelOrder,
  seller: LabelSeller,
  volume: LabelVolume,
): { ok: true; body: CartRequest } | { ok: false; reason: string } {
  const a = seller.address
  // Reuses the origin rules so label creation and the seller form never disagree.
  const originOk = hasShippingOrigin({
    addressPostalCode: a.postalCode,
    addressStreet: a.street,
    addressNumber: a.number,
    addressComplement: a.complement,
    addressDistrict: a.district,
    addressCity: a.city,
    addressState: a.state,
  })
  if (!originOk) return { ok: false, reason: "Endereço de envio da loja incompleto" }

  // Melhor Envio rejects the purchase without a valid CPF (11) or CNPJ (14) on the sender.
  if (![11, 14].includes(digits(seller.cpfCnpj ?? "").length)) return { ok: false, reason: "CPF/CNPJ da loja ausente" }

  const buyerDocument = digits(order.buyerDocument ?? "")
  if (!buyerDocument) return { ok: false, reason: "CPF/CNPJ do comprador ausente" }

  const to = order.address
  if (!filled(to.number) || !filled(to.district)) {
    return { ok: false, reason: "Número ou bairro do comprador ausente" }
  }

  // Sum in cents and convert once, to avoid floating-point drift across items.
  const insuranceCents = order.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

  return {
    ok: true,
    body: {
      service: order.serviceId,
      from: {
        name: seller.name,
        phone: digits(seller.phone),
        email: seller.email,
        document: digits(seller.cpfCnpj),
        address: a.street,
        complement: a.complement ?? "",
        number: a.number,
        district: a.district,
        city: a.city,
        state_abbr: a.state,
        country_id: "BR",
        postal_code: digits(a.postalCode ?? ""),
      },
      to: {
        name: `${to.firstName} ${to.lastName}`.trim(),
        phone: digits(to.phone),
        email: order.email,
        document: buyerDocument,
        address: to.street,
        complement: to.complement,
        number: to.number,
        district: to.district,
        city: to.city,
        state_abbr: to.state,
        country_id: "BR",
        postal_code: digits(to.postalCode),
      },
      products: order.items.map((i) => ({ name: i.title, quantity: i.quantity, unitary_value: i.unitPrice / 100 })),
      volumes: [volume],
      options: {
        insurance_value: insuranceCents / 100,
        receipt: false,
        own_hand: false,
        reverse: false,
        non_commercial: true,
        tags: [{ tag: `Pedido #${order.displayId}` }],
      },
    },
  }
}
