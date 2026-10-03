import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  isTestCashEnabled,
  TEST_CASH_ORDER_APPROVED_EVENT,
  TEST_CASH_PAYMENT_METHOD,
} from "../../../../utils/sandbox-cash"
import { buildCheckoutSnapshot, checkoutRequestSchema } from "../../../../utils/checkout-payload"
import { createOrdersFromCheckout } from "../../../../utils/create-orders-from-checkout"
import { CHECKOUT_MODULE } from "../../../../modules/checkout"
import type CheckoutModuleService from "../../../../modules/checkout/service"

// Lets the storefront decide at runtime whether to offer the option, so no
// build-time flag can leak it into a production image.
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.json({ enabled: isTestCashEnabled() })
}

/**
 * Test-only checkout: creates the orders immediately, as if paid in cash,
 * without touching MercadoPago. Exists to keep end-to-end testing possible
 * while MercadoPago test credentials are unstable.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Indistinguishable from a missing route when disabled.
  if (!isTestCashEnabled()) {
    return res.status(404).json({ message: "Not Found" })
  }

  const parsed = checkoutRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const built = await buildCheckoutSnapshot(query, parsed.data)
  if ("unresolvedProductId" in built) {
    return res.status(400).json({
      error: "Produto sem vendedor associado.",
      productId: built.unresolvedProductId,
    })
  }

  const logger = req.scope.resolve("logger")
  const externalReference = crypto.randomUUID()

  try {
    const checkoutService: CheckoutModuleService = req.scope.resolve(CHECKOUT_MODULE)
    await checkoutService.recordSnapshot(externalReference, built.payload)

    const createdOrders = await createOrdersFromCheckout({
      container: req.scope,
      externalReference,
      meta: built.payload,
      extraMetadata: { payment_method: TEST_CASH_PAYMENT_METHOD },
    })

    const eventBusService = req.scope.resolve(Modules.EVENT_BUS)
    await eventBusService.emit(
      createdOrders.flatMap((order) => [
        { name: "order.placed", data: { id: order.id } },
        { name: TEST_CASH_ORDER_APPROVED_EVENT, data: { id: order.id } },
      ])
    )

    logger.info(
      `[checkout/sandbox-cash] ${createdOrders.length} pedido(s) de teste criado(s) para ref ${externalReference}`
    )
    res.json({ external_reference: externalReference })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    logger.error(`[checkout/sandbox-cash] falha ao criar pedido de teste: ${msg}`)
    res.status(500).json({ error: "Erro ao criar pedido de teste.", detail: msg })
  }
}
