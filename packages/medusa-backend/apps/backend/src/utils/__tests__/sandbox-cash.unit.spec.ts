import { isTestCashEnabled, TEST_CASH_ORDER_APPROVED_EVENT, TEST_CASH_PAYMENT_METHOD } from "../sandbox-cash"

describe("isTestCashEnabled", () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  it("is disabled by default (flag unset)", () => {
    delete process.env.TEST_CASH_PAYMENT_ENABLED
    delete process.env.MARKETPLACE_SANDBOX
    expect(isTestCashEnabled()).toBe(false)
  })

  it("is enabled when flag is 'true' and sandbox mode is on", () => {
    process.env.TEST_CASH_PAYMENT_ENABLED = "true"
    delete process.env.MARKETPLACE_SANDBOX
    expect(isTestCashEnabled()).toBe(true)
  })

  it("is disabled when flag is 'true' but MARKETPLACE_SANDBOX=false (production)", () => {
    process.env.TEST_CASH_PAYMENT_ENABLED = "true"
    process.env.MARKETPLACE_SANDBOX = "false"
    expect(isTestCashEnabled()).toBe(false)
  })

  it.each(["TRUE", "1", " true", "yes", "false", ""])(
    "treats flag value %p as disabled (only the exact string 'true' enables it)",
    (value) => {
      process.env.TEST_CASH_PAYMENT_ENABLED = value
      delete process.env.MARKETPLACE_SANDBOX
      expect(isTestCashEnabled()).toBe(false)
    }
  )

  it("exposes the event name and payment method constants", () => {
    expect(TEST_CASH_ORDER_APPROVED_EVENT).toBe("test_cash.order_approved")
    expect(TEST_CASH_PAYMENT_METHOD).toBe("test_cash")
  })
})
