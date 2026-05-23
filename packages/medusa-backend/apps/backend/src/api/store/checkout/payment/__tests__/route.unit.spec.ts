import { MercadoPagoConfig, Payment } from "mercadopago"

jest.mock("mercadopago")
jest.mock("crypto", () => ({ randomUUID: () => "idempotency-key-1234" }))

const MockPayment = Payment as jest.MockedClass<typeof Payment>

import { POST } from "../route"

const makeReq = (body: unknown, env: Record<string, string> = {}) => {
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-token",
    ...env,
  })
  return { body } as any
}

const makeRes = () => {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const cardBody = {
  token: "card-token-abc",
  payment_method_id: "visa",
  installments: 3,
  issuer_id: "24",
  transaction_amount: 104.0,
  external_reference: "order-ref-uuid",
  payer: {
    email: "buyer@test.com",
    identification: { type: "CPF", number: "12345678909" },
    first_name: "João",
    last_name: "Silva",
  },
}

const pixBody = {
  payment_method_id: "pix",
  transaction_amount: 104.0,
  external_reference: "order-ref-uuid",
  payer: { email: "buyer@test.com" },
}

describe("POST /store/checkout/payment", () => {
  let mockPaymentCreate: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockPaymentCreate = jest.fn()
    MockPayment.mockImplementation(() => ({ create: mockPaymentCreate } as any))
    ;(MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>).mockImplementation(() => ({} as any))
  })

  it("returns payment_id and status for an approved card payment", async () => {
    mockPaymentCreate.mockResolvedValue({
      id: 123456,
      status: "approved",
      status_detail: "accredited",
      point_of_interaction: null,
    })

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(200)
    expect(res._body).toEqual({
      payment_id: 123456,
      status: "approved",
      status_detail: "accredited",
      point_of_interaction: null,
    })
  })

  it("calls Payment.create with correct card fields", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 1, status: "approved", status_detail: "accredited" })

    await POST(makeReq(cardBody), makeRes())

    const call = mockPaymentCreate.mock.calls[0][0]
    expect(call.body.token).toBe("card-token-abc")
    expect(call.body.payment_method_id).toBe("visa")
    expect(call.body.installments).toBe(3)
    expect(call.body.issuer_id).toBe(24)
    expect(call.body.transaction_amount).toBe(104.0)
    expect(call.body.external_reference).toBe("order-ref-uuid")
    expect(call.requestOptions.idempotencyKey).toBe("idempotency-key-1234")
  })

  it("returns point_of_interaction for PIX payments", async () => {
    const pixInteraction = { transaction_data: { qr_code: "qr-string", qr_code_base64: "base64" } }
    mockPaymentCreate.mockResolvedValue({
      id: 789,
      status: "pending",
      status_detail: "pending_waiting_transfer",
      point_of_interaction: pixInteraction,
    })

    const res = makeRes()
    await POST(makeReq(pixBody), res)

    expect(res._status).toBe(200)
    expect((res._body as any).point_of_interaction).toEqual(pixInteraction)
    expect((res._body as any).status).toBe("pending")
  })

  it("defaults installments to 1 when not provided", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 1, status: "approved", status_detail: "accredited" })

    await POST(makeReq(pixBody), makeRes())

    const call = mockPaymentCreate.mock.calls[0][0]
    expect(call.body.installments).toBe(1)
  })

  it("includes notification_url when BACKEND_URL is set", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 1, status: "approved", status_detail: "accredited" })

    await POST(makeReq(cardBody, { BACKEND_URL: "https://abc.ngrok.io" }), makeRes())

    const call = mockPaymentCreate.mock.calls[0][0]
    expect(call.body.notification_url).toBe("https://abc.ngrok.io/webhooks/mercadopago")
  })

  it("omits notification_url when BACKEND_URL is not set", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 1, status: "approved", status_detail: "accredited" })

    await POST(makeReq(cardBody, { BACKEND_URL: "" }), makeRes())

    const call = mockPaymentCreate.mock.calls[0][0]
    expect(call.body.notification_url).toBeUndefined()
  })

  it("returns 400 when body fails schema validation", async () => {
    const res = makeRes()
    await POST(makeReq({ payment_method_id: "visa" }), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
    expect(mockPaymentCreate).not.toHaveBeenCalled()
  })

  it("returns 503 when MERCADOPAGO_ACCESS_TOKEN is not set", async () => {
    const res = makeRes()
    await POST(makeReq(cardBody, { MERCADOPAGO_ACCESS_TOKEN: "" }), res)

    expect(res._status).toBe(503)
    expect(mockPaymentCreate).not.toHaveBeenCalled()
  })

  it("returns 500 when the MP SDK throws", async () => {
    mockPaymentCreate.mockRejectedValue(new Error("card rejected"))

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(500)
    expect((res._body as any).detail).toBe("card rejected")
  })

  it("handles rejected card payment status", async () => {
    mockPaymentCreate.mockResolvedValue({
      id: 999,
      status: "rejected",
      status_detail: "cc_rejected_insufficient_amount",
      point_of_interaction: null,
    })

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(200)
    expect((res._body as any).status).toBe("rejected")
    expect((res._body as any).status_detail).toBe("cc_rejected_insufficient_amount")
  })
})
