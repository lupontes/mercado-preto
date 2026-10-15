import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { backfillShippingStatus } from "../utils/shipping-status"

/**
 * One-off: marks orders created before shipping_status existed as
 * "Aguardando envio". Safe to re-run — orders that already have a status
 * (and canceled ones) are skipped.
 *   npx medusa exec ./src/scripts/backfill-shipping-status.ts
 */
export default async function backfillShippingStatusScript({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const updated = await backfillShippingStatus(container.resolve(Modules.ORDER))
  logger.info(`[backfill-shipping-status] ${updated.length} pedido(s) atualizado(s): ${updated.join(", ") || "nenhum"}`)
}
