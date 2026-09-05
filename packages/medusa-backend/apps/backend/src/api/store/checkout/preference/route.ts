import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Preference } from "mercadopago"
import { z } from "zod"
import { validateDocument } from "../../../../utils/validate-document"
import { groupItemsBySeller } from "../../../../utils/seller-order-groups"
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"

const schema = z.object({
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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(503).json({ error: "MercadoPago não configurado." })
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }

  const { items, address, shipping, total, document } = parsed.data
  const { digits: buyerDocument } = validateDocument(document)
  const storeCors = process.env.STORE_CORS?.split(",")[0] ?? "http://localhost:3000"
  const backendUrl = process.env.BACKEND_URL

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
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
    return res.status(400).json({
      error: "Produto sem vendedor associado.",
      productId: grouped.unresolvedProductId,
    })
  }

  const externalReference = crypto.randomUUID()

  const checkoutSnapshotPayload = {
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
  }

  const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)

  try {
    await checkoutService.recordSnapshot(externalReference, checkoutSnapshotPayload)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return res.status(500).json({ error: "Erro ao salvar snapshot do checkout.", detail: msg })
  }

  const mp = new MercadoPagoConfig({ accessToken })
  const preference = new Preference(mp)

  try {
    const result = await preference.create({
      body: {
        items: [
          ...items.map((item) => ({
            id: item.variantId ?? item.title.toLowerCase().replace(/\s+/g, "-"),
            title: item.title,
            quantity: item.quantity,
            unit_price: item.price / 100,
            currency_id: "BRL",
          })),
          ...(shipping.price > 0
            ? [
                {
                  id: `frete-${shipping.id}`,
                  title: `Frete — ${shipping.name}`,
                  quantity: 1,
                  unit_price: shipping.price / 100,
                  currency_id: "BRL",
                },
              ]
            : []),
        ],
        payer: {
          name: address.firstName,
          surname: address.lastName,
          email: address.email,
          phone: address.phone ? { number: address.phone } : undefined,
          address: {
            street_name: address.address1,
            street_number: address.address2 ?? "",
            zip_code: address.cep.replace(/\D/g, ""),
          },
        },
        payment_methods: {
          installments: 12,
        },
        back_urls: {
          success: `${storeCors}/checkout/sucesso`,
          failure: `${storeCors}/checkout/erro`,
          pending: `${storeCors}/checkout/pendente`,
        },
        ...(storeCors.startsWith("https") ? { auto_return: "approved" } : {}),
        statement_descriptor: "MERCADO PRETO",
        external_reference: externalReference,
        // notification_url só funciona com URL pública (HTTPS). Em desenvolvimento local,
        // configure BACKEND_URL com uma URL de túnel (ex: ngrok) para receber webhooks.
        ...(backendUrl ? { notification_url: `${backendUrl}/webhooks/mercadopago` } : {}),
        // Snapshot do pedido pra rastreabilidade via webhook — mesmo payload
        // gravado no nosso banco acima (checkoutSnapshotPayload), fonte de
        // verdade primária caso payment.metadata volte vazio.
        metadata: checkoutSnapshotPayload,
      },
    })

    try {
      await checkoutService.attachPreferenceId(externalReference, result.id as string)
    } catch (attachErr: unknown) {
      const logger = req.scope.resolve("logger") as { warn: (msg: string) => void }
      logger.warn(`[checkout/preference] falha ao gravar preferenceId no snapshot: ${attachErr}`)
    }

    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      external_reference: externalReference,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    res.status(500).json({ error: "Erro ao criar preferência MercadoPago.", detail: msg })
  }
}
