import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { MercadoPagoConfig, Preference, Payment, PaymentRefund } from "mercadopago"

jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    AbstractPaymentProvider: class {
      constructor(_container: unknown, _options: unknown) {}
    },
  }
})

jest.mock("mercadopago")

import MercadoPagoPaymentProvider from "../provider"

const MockMercadoPagoConfig = MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>
const MockPreference = Preference as jest.MockedClass<typeof Preference>
const MockPayment = Payment as jest.MockedClass<typeof Payment>
const MockPaymentRefund = PaymentRefund as jest.MockedClass<typeof PaymentRefund>

const CONTAINER = {} as Record<string, unknown>
const OPTIONS = { accessToken: "test-access-token" }

describe("MercadoPagoPaymentProvider", () => {
  let provider: MercadoPagoPaymentProvider
  let mockPreferenceCreate: jest.Mock
  let mockPaymentGet: jest.Mock
  let mockPaymentCancel: jest.Mock
  let mockRefundCreate: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    mockPreferenceCreate = jest.fn()
    mockPaymentGet = jest.fn()
    mockPaymentCancel = jest.fn()
    mockRefundCreate = jest.fn()

    MockMercadoPagoConfig.mockImplementation(() => ({} as any))
    MockPreference.mockImplementation(() => ({ create: mockPreferenceCreate } as any))
    MockPayment.mockImplementation(() => ({ get: mockPaymentGet, cancel: mockPaymentCancel } as any))
    MockPaymentRefund.mockImplementation(() => ({ create: mockRefundCreate } as any))

    provider = new MercadoPagoPaymentProvider(CONTAINER, OPTIONS)
  })

  describe("initiatePayment", () => {
    it("creates a preference and returns its id and redirect URLs", async () => {
      mockPreferenceCreate.mockResolvedValue({
        id: "pref-123",
        init_point: "https://mp.com/pay/pref-123",
        sandbox_init_point: "https://sandbox.mp.com/pay/pref-123",
      })

      const result = await provider.initiatePayment({
        amount: 10000,
        currency_code: "brl",
        context: { idempotency_key: "idem-1" },
      } as any)

      expect(result).toEqual({
        id: "pref-123",
        data: {
          preference_id: "pref-123",
          init_point: "https://mp.com/pay/pref-123",
          sandbox_init_point: "https://sandbox.mp.com/pay/pref-123",
        },
      })
    })

    it("converts amount from cents to reais before sending to MP", async () => {
      mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

      await provider.initiatePayment({
        amount: 5050,
        currency_code: "brl",
        context: { idempotency_key: "idem-1" },
      } as any)

      const { body } = mockPreferenceCreate.mock.calls[0][0]
      expect(body.items[0].unit_price).toBe(50.5)
    })

    it("returns a payment provider error when the MP SDK throws", async () => {
      mockPreferenceCreate.mockRejectedValue(new Error("MP API unavailable"))

      const result = await provider.initiatePayment({
        amount: 1000,
        currency_code: "brl",
        context: { idempotency_key: "idem-1" },
      } as any) as any

      expect(result.code).toBe("MERCADOPAGO_ERROR")
      expect(result.detail).toContain("MP API unavailable")
    })
  })

  describe("authorizePayment", () => {
    it("returns CAPTURED status for an approved payment", async () => {
      mockPaymentGet.mockResolvedValue({ status: "approved" })

      const result = await provider.authorizePayment({ data: { payment_id: "123" } } as any) as any

      expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    })

    it("returns AUTHORIZED status for an authorized payment", async () => {
      mockPaymentGet.mockResolvedValue({ status: "authorized" })

      const result = await provider.authorizePayment({ data: { payment_id: "123" } } as any) as any

      expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED)
    })

    it("returns PENDING without calling the SDK when payment_id is absent", async () => {
      const result = await provider.authorizePayment({ data: { payment_id: "" } } as any) as any

      expect(result.status).toBe(PaymentSessionStatus.PENDING)
      expect(mockPaymentGet).not.toHaveBeenCalled()
    })

    it("returns a payment provider error when the MP SDK throws", async () => {
      mockPaymentGet.mockRejectedValue(new Error("Payment not found"))

      const result = await provider.authorizePayment({ data: { payment_id: "123" } } as any) as any

      expect(result.code).toBe("MERCADOPAGO_ERROR")
    })
  })

  describe("capturePayment", () => {
    it("returns data unchanged because MP captures automatically", async () => {
      const data = { payment_id: "123", extra: "value" }
      const result = await provider.capturePayment({ data } as any)

      expect(result).toEqual({ data })
    })
  })

  describe("cancelPayment", () => {
    it("calls MP cancel and returns cancelled: true", async () => {
      mockPaymentCancel.mockResolvedValue({})

      const result = await provider.cancelPayment({ data: { payment_id: "456" } } as any) as any

      expect(mockPaymentCancel).toHaveBeenCalledWith({ id: 456 })
      expect(result.data.cancelled).toBe(true)
    })

    it("returns data unchanged when payment_id is absent", async () => {
      const data = { payment_id: "" }
      const result = await provider.cancelPayment({ data } as any)

      expect(result).toEqual({ data })
      expect(mockPaymentCancel).not.toHaveBeenCalled()
    })

    it("returns a payment provider error when the MP SDK throws", async () => {
      mockPaymentCancel.mockRejectedValue(new Error("Already cancelled"))

      const result = await provider.cancelPayment({ data: { payment_id: "123" } } as any) as any

      expect(result.code).toBe("MERCADOPAGO_ERROR")
    })
  })

  describe("refundPayment", () => {
    it("creates a refund converting the amount from cents to reais", async () => {
      mockRefundCreate.mockResolvedValue({})

      const result = await provider.refundPayment({ data: { payment_id: "123" }, amount: 5000 } as any) as any

      expect(mockRefundCreate).toHaveBeenCalledWith({
        payment_id: 123,
        body: { amount: 50 },
      })
      expect(result.data.refunded).toBe(true)
      expect(result.data.refundAmount).toBe(5000)
    })
  })

  describe("retrievePayment", () => {
    it("returns payment details merged with the original data", async () => {
      const mpPayment = { id: 123, status: "approved" }
      mockPaymentGet.mockResolvedValue(mpPayment)

      const result = await provider.retrievePayment({ data: { payment_id: "123" } } as any) as any

      expect(result.data.payment).toEqual(mpPayment)
      expect(result.data.payment_id).toBe("123")
    })

    it("returns data unchanged when payment_id is absent", async () => {
      const data = { payment_id: "" }
      const result = await provider.retrievePayment({ data } as any)

      expect(result).toEqual({ data })
      expect(mockPaymentGet).not.toHaveBeenCalled()
    })
  })

  describe("deletePayment", () => {
    it("returns data unchanged (no-op)", async () => {
      const data = { payment_id: "123" }
      const result = await provider.deletePayment({ data } as any)

      expect(result).toEqual({ data })
    })
  })

  describe("getPaymentStatus", () => {
    const statusMapping: [string, PaymentSessionStatus][] = [
      ["approved", PaymentSessionStatus.CAPTURED],
      ["authorized", PaymentSessionStatus.AUTHORIZED],
      ["in_process", PaymentSessionStatus.PENDING],
      ["pending", PaymentSessionStatus.PENDING],
      ["cancelled", PaymentSessionStatus.CANCELED],
      ["refunded", PaymentSessionStatus.CANCELED],
      ["charged_back", PaymentSessionStatus.CANCELED],
      ["rejected", PaymentSessionStatus.ERROR],
    ]

    it.each(statusMapping)(
      'maps MP status "%s" to Medusa status "%s"',
      async (mpStatus, expected) => {
        mockPaymentGet.mockResolvedValue({ status: mpStatus })

        const result = await provider.getPaymentStatus({ data: { payment_id: "123" } } as any)

        expect(result.status).toBe(expected)
      }
    )

    it("returns PENDING when no payment_id is provided", async () => {
      const result = await provider.getPaymentStatus({ data: { payment_id: "" } } as any)

      expect(result.status).toBe(PaymentSessionStatus.PENDING)
      expect(mockPaymentGet).not.toHaveBeenCalled()
    })

    it("returns ERROR when the SDK throws", async () => {
      mockPaymentGet.mockRejectedValue(new Error("Network error"))

      const result = await provider.getPaymentStatus({ data: { payment_id: "123" } } as any)

      expect(result.status).toBe(PaymentSessionStatus.ERROR)
    })
  })

  describe("getWebhookActionAndData", () => {
    const makePayload = (type: string, id: string) => ({
      data: { type, data: { id } },
    })

    it('returns "not_supported" for non-payment webhook types', async () => {
      const result = await provider.getWebhookActionAndData(makePayload("order", "123") as any)

      expect(result.action).toBe("not_supported")
      expect(mockPaymentGet).not.toHaveBeenCalled()
    })

    it('returns "authorized" with session_id and amount for an authorized payment', async () => {
      mockPaymentGet.mockResolvedValue({
        status: "authorized",
        external_reference: "session-abc",
        transaction_amount: 100,
      })

      const result = await provider.getWebhookActionAndData(makePayload("payment", "456") as any) as any

      expect(result.action).toBe("authorized")
      expect(result.data.session_id).toBe("session-abc")
      expect(result.data.amount).toBe(10000)
    })

    it('returns "captured" with amount in cents for an approved payment', async () => {
      mockPaymentGet.mockResolvedValue({
        status: "approved",
        external_reference: "session-def",
        transaction_amount: 250.5,
      })

      const result = await provider.getWebhookActionAndData(makePayload("payment", "789") as any) as any

      expect(result.action).toBe("captured")
      expect(result.data.session_id).toBe("session-def")
      expect(result.data.amount).toBe(25050)
    })

    it('returns "failed" for a cancelled payment', async () => {
      mockPaymentGet.mockResolvedValue({
        status: "cancelled",
        external_reference: "session-ghi",
      })

      const result = await provider.getWebhookActionAndData(makePayload("payment", "123") as any) as any

      expect(result.action).toBe("failed")
      expect(result.data?.session_id).toBe("session-ghi")
    })

    it('returns "failed" when the SDK throws', async () => {
      mockPaymentGet.mockRejectedValue(new Error("SDK error"))

      const result = await provider.getWebhookActionAndData(makePayload("payment", "123") as any)

      expect(result.action).toBe("failed")
    })
  })
})
