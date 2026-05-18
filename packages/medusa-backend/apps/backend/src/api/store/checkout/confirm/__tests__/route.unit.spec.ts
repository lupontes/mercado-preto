import { MercadoPagoConfig, Payment } from "mercadopago"

jest.mock("mercadopago")

const MockPayment = Payment as jest.MockedClass<typeof Payment>

import { GET } from "../route"

const makeReq = (query: Record<string, string>, env: Record<string, string> = {}) => {
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-token",
    ...env,
  })
  return { query } as any
}

const makeRes = () => {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const mpPayment = {
  status: "approved",
  status_detail: "accredited",
  external_reference: "order-ref-123",
  transaction_amount: 104,
  payer: { email: "buyer@test.com", first_name: "João", last_name: "Silva" },
  metadata: { seller_id: "seller-1" },
}

describe("GET /store/checkout/confirm", () => {
  let mockPaymentGet: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockPaymentGet = jest.fn()
    MockPayment.mockImplementation(() => ({ get: mockPaymentGet } as any))
    ;(MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>).mockImplementation(() => ({} as any))
  })

  it("returns payment details for a valid payment_id", async () => {
    mockPaymentGet.mockResolvedValue(mpPayment)

    const res = makeRes()
    await GET(makeReq({ payment_id: "9876543" }), res)

    expect(res._status).toBe(200)
    expect(res._body).toEqual({
      status: "approved",
      status_detail: "accredited",
      external_reference: "order-ref-123",
      transaction_amount: 104,
      payer: {
        email: "buyer@test.com",
        first_name: "João",
        last_name: "Silva",
      },
      metadata: { seller_id: "seller-1" },
    })
  })

  it("calls MP SDK with the payment_id converted to number", async () => {
    mockPaymentGet.mockResolvedValue(mpPayment)

    await GET(makeReq({ payment_id: "9876543" }), makeRes())

    expect(mockPaymentGet).toHaveBeenCalledWith({ id: 9876543 })
  })

  it("returns 400 when payment_id is missing", async () => {
    const res = makeRes()
    await GET(makeReq({}), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toMatch(/payment_id/)
    expect(mockPaymentGet).not.toHaveBeenCalled()
  })

  it("returns 503 when MERCADOPAGO_ACCESS_TOKEN is not set", async () => {
    const res = makeRes()
    await GET(makeReq({ payment_id: "123" }, { MERCADOPAGO_ACCESS_TOKEN: "" }), res)

    expect(res._status).toBe(503)
    expect(mockPaymentGet).not.toHaveBeenCalled()
  })

  it("returns 500 when the MP SDK throws", async () => {
    mockPaymentGet.mockRejectedValue(new Error("Payment not found"))

    const res = makeRes()
    await GET(makeReq({ payment_id: "999" }), res)

    expect(res._status).toBe(500)
    expect((res._body as any).detail).toBe("Payment not found")
  })

  it("handles credit card approved status correctly", async () => {
    mockPaymentGet.mockResolvedValue({
      ...mpPayment,
      status: "approved",
      status_detail: "accredited",
    })

    const res = makeRes()
    await GET(makeReq({ payment_id: "123" }), res)

    expect((res._body as any).status).toBe("approved")
    expect((res._body as any).status_detail).toBe("accredited")
  })

  it("handles credit card rejected status correctly", async () => {
    mockPaymentGet.mockResolvedValue({
      ...mpPayment,
      status: "rejected",
      status_detail: "cc_rejected_insufficient_amount",
    })

    const res = makeRes()
    await GET(makeReq({ payment_id: "123" }), res)

    expect((res._body as any).status).toBe("rejected")
    expect((res._body as any).status_detail).toBe("cc_rejected_insufficient_amount")
  })

  it("handles in_process status for pending credit card review", async () => {
    mockPaymentGet.mockResolvedValue({
      ...mpPayment,
      status: "in_process",
      status_detail: "pending_review_manual",
    })

    const res = makeRes()
    await GET(makeReq({ payment_id: "123" }), res)

    expect((res._body as any).status).toBe("in_process")
  })
})
