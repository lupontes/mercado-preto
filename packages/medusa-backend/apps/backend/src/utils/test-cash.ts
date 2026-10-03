import { isSandboxMode } from "./sandbox"

export const TEST_CASH_PAYMENT_METHOD = "test_cash"

// Dedicated event so commission runs for test-cash orders while NF-e emission
// (which listens to mercadopago.order_approved) does not.
export const TEST_CASH_ORDER_APPROVED_EVENT = "test_cash.order_approved"

/**
 * Test-only payment that creates orders without charging anyone. Requires both
 * an explicit opt-in flag and sandbox mode: MARKETPLACE_SANDBOX defaults to
 * "true" in docker-compose.prod.yml, so sandbox mode alone is not a safe guard.
 */
export function isTestCashEnabled(): boolean {
  return process.env.TEST_CASH_PAYMENT_ENABLED === "true" && isSandboxMode()
}
