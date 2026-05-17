import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MercadoPagoConfig, Preference } from "mercadopago"
import { z } from "zod"

const schema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      quantity: z.number().int().positive(),
      price: z.number().int().positive(),
      variantId: z.string().optional(),
    })
  ),
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
  sellerId: z.string().optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(503).json({ error: "MercadoPago não configurado." })
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    console.error("[checkout/preference] validation error:", JSON.stringify(parsed.error.flatten()))
    console.error("[checkout/preference] body received:", JSON.stringify(req.body))
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }

  const { items, address, shipping, total, sellerId } = parsed.data
  const storeCors = process.env.STORE_CORS?.split(",")[0] ?? "http://localhost:3000"
  const backendUrl = process.env.BACKEND_URL

  const externalReference = crypto.randomUUID()

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
        // Snapshot do pedido para rastreabilidade via webhook
        metadata: {
          seller_id: sellerId,
          items: items.map((i) => ({
            variant_id: i.variantId,
            title: i.title,
            quantity: i.quantity,
            price: i.price,
          })),
          shipping: { id: shipping.id, name: shipping.name, price: shipping.price },
          total,
        },
      },
    })

    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      external_reference: externalReference,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    console.error("[checkout/preference] MercadoPago error:", err)
    res.status(500).json({ error: "Erro ao criar preferência MercadoPago.", detail: msg })
  }
}
