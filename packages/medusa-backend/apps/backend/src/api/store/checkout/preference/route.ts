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
import { z } from "zod"
import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"
import { CENTS_PER_POINT } from "../../../../modules/loyalty/constants"
import { COMMISSION_MODULE } from "../../../../modules/commission"
import type CommissionModuleService from "../../../../modules/commission/service"
import { allocateLoyaltyDiscount, loyaltyDiscountCap } from "../../../../utils/loyalty-discount"
import { verifyLoyaltyToken } from "../../../../utils/loyalty-token"
import { validateDocument } from "../../../../utils/validate-document"

const preferenceRequestSchema = checkoutRequestSchema.extend({
  redeemPoints: z.number().int().positive().optional(),
  loyaltyToken: z.string().optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(503).json({ error: "MercadoPago não configurado." })
  }

  const parsed = preferenceRequestSchema.safeParse(req.body)
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
  const checkoutSnapshotPayload: typeof built.payload & {
    loyalty_points?: number
    loyalty_discount?: number
  } = built.payload

  // Points are spent only with a token proving the buyer confirmed the code
  // e-mailed for this same document; the CPF alone is never enough.
  let pointsToReserve = 0
  const buyerDocument = validateDocument(parsed.data.document).digits as string
  if (parsed.data.redeemPoints) {
    const token = parsed.data.loyaltyToken ? verifyLoyaltyToken(parsed.data.loyaltyToken) : null
    if (!token || token.document !== buyerDocument) {
      return res.status(401).json({ error: "Confirme seus pontos novamente." })
    }
    const loyalty: LoyaltyModuleService = req.scope.resolve(LOYALTY_MODULE)
    const commission: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
    const itemsTotal = checkoutSnapshotPayload.items.reduce((sum, i) => sum + i.price * i.quantity, 0)
    const cap = Math.floor(loyaltyDiscountCap(itemsTotal, await commission.getCommissionRate()) / CENTS_PER_POINT)
    pointsToReserve = Math.min(parsed.data.redeemPoints, cap)
    if (pointsToReserve > (await loyalty.availableBalance(buyerDocument))) {
      return res.status(400).json({ error: "Saldo de pontos insuficiente." })
    }
  }
  const discount = pointsToReserve * CENTS_PER_POINT
  if (discount > 0) {
    const shares = allocateLoyaltyDiscount(
      checkoutSnapshotPayload.seller_groups.map((g) => ({ sellerId: g.sellerId, itemsTotal: g.subtotal })),
      discount
    )
    checkoutSnapshotPayload.seller_groups = checkoutSnapshotPayload.seller_groups.map((g) => ({
      ...g,
      loyalty_discount: shares[g.sellerId] ?? 0,
    }))
    checkoutSnapshotPayload.loyalty_points = pointsToReserve
    checkoutSnapshotPayload.loyalty_discount = discount
    checkoutSnapshotPayload.total -= discount
  }

  const externalReference = crypto.randomUUID()

  const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)

  try {
    await checkoutService.recordSnapshot(externalReference, checkoutSnapshotPayload, { status: "pending" })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return res.status(500).json({ error: "Erro ao salvar snapshot do checkout.", detail: msg })
  }

  let loyalty: LoyaltyModuleService | null = null
  if (pointsToReserve > 0) {
    loyalty = req.scope.resolve(LOYALTY_MODULE)
    // Another checkout may have spent the points since the balance check above.
    if (!(await loyalty!.reserve(buyerDocument, externalReference, pointsToReserve))) {
      return res.status(400).json({ error: "Saldo de pontos insuficiente." })
    }
  }

  const mp = new MercadoPagoConfig({ accessToken })
  const preference = new Preference(mp)

  // MercadoPago rejects negative prices, so a discounted checkout is sent as a
  // single line with the amount actually charged.
  const preferenceItems =
    discount > 0
      ? [{ id: "pedido", title: "Pedido Mercado Preto", quantity: 1, unit_price: checkoutSnapshotPayload.total / 100, currency_id: "BRL" }]
      : [
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
        ]

  try {
    const result = await preference.create({
      body: {
        items: preferenceItems,
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
      ...(discount > 0 ? { pointsApplied: pointsToReserve, discount } : {}),
    })
  } catch (err: unknown) {
    // Without a preference the buyer cannot pay, so the points go back now.
    if (loyalty) await loyalty.cancelReservation(externalReference).catch(() => {})
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    res.status(500).json({ error: "Erro ao criar preferência MercadoPago.", detail: msg })
  }
}
