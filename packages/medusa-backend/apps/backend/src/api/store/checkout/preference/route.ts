import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Preference } from "mercadopago"
import { buildCheckoutSnapshot, checkoutRequestSchema } from "../../../../utils/checkout-payload"
import { resolveCheckoutItems } from "../../../../utils/checkout-items"
import { resolveCheckoutShipping } from "../../../../utils/checkout-shipping"
import { getShippingCalculator } from "../../../../utils/melhor-envio"
import { defaultQuoteCache } from "../../../../utils/shipping-quote"
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(503).json({ error: "MercadoPago não configurado." })
  }

  const parsed = checkoutRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }

  const storeCors = process.env.STORE_CORS?.split(",")[0] ?? "http://localhost:3000"
  const backendUrl = process.env.BACKEND_URL

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const resolved = await resolveCheckoutItems(query, parsed.data.items)
  if (!resolved.ok) return res.status(resolved.status).json(resolved.body)
  // From here on only database-resolved items are used, never the browser's price/title.
  const request = { ...parsed.data, items: resolved.items }
  const { items, address } = request

  const shipping = await resolveCheckoutShipping(
    { query, calculator: getShippingCalculator(), cache: defaultQuoteCache, logger: req.scope.resolve("logger") },
    request
  )
  if (!shipping.ok) return res.status(shipping.status).json(shipping.body)
  const option = shipping.option

  const built = await buildCheckoutSnapshot(query, request, option)
  if ("unresolvedVariantId" in built) {
    return res.status(400).json({
      error: "Produto sem vendedor associado.",
      variantId: built.unresolvedVariantId,
    })
  }
  const checkoutSnapshotPayload = built.payload

  const externalReference = crypto.randomUUID()

  const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)

  try {
    await checkoutService.recordSnapshot(externalReference, checkoutSnapshotPayload, { status: "pending" })
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
          ...(option.total > 0
            ? [
                {
                  id: `frete-${option.tier}`,
                  title: `Frete — ${option.label}`,
                  quantity: 1,
                  unit_price: option.total / 100,
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
      total: checkoutSnapshotPayload.total,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    res.status(500).json({ error: "Erro ao criar preferência MercadoPago.", detail: msg })
  }
}
