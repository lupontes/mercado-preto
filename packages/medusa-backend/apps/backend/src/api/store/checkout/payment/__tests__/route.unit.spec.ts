import { MercadoPagoConfig, Payment } from "mercadopago"

jest.mock("mercadopago")
jest.mock("crypto", () => ({ randomUUID: () => "idempotency-key-1234" }))

const MockPayment = Payment as jest.MockedClass<typeof Payment>

import { POST } from "../route"

let checkoutService: {
  findByExternalReference: jest.Mock
  transitionFromPending: jest.Mock
}
let logger: { warn: jest.Mock; error: jest.Mock }

const makeReq = (body: unknown, env: Record<string, string> = {}) => {
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-token",
    ...env,
  })
  const services: Record<string, unknown> = { checkout: checkoutService, logger }
  return { body, scope: { resolve: (key: string) => services[key] } } as any
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
    checkoutService = {
      findByExternalReference: jest.fn().mockResolvedValue({
        payload: { total: 10400 },
        status: null,
      }),
      transitionFromPending: jest.fn().mockResolvedValue(true),
    }
    logger = { warn: jest.fn(), error: jest.fn() }
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

  it("answers 502 with a friendly message and no detail when the MP SDK throws", async () => {
    mockPaymentCreate.mockRejectedValue(new Error("card rejected"))

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(502)
    expect(res._body).toEqual({ error: "Não foi possível processar o pagamento. Tente novamente em instantes." })
    expect(logger.error).toHaveBeenCalledTimes(1)
    const args = logger.error.mock.calls[0]
    expect(args.length).toBeLessThanOrEqual(2)
    expect(args[0]).toContain("card rejected")
  })

  it("translates MP error 2034", async () => {
    mockPaymentCreate.mockRejectedValue({ message: "Invalid users involved", cause: [{ code: 2034 }] })

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(502)
    expect(res._body).toEqual({ error: "Não foi possível usar este e-mail no pagamento. Confira o e-mail ou use outro." })
    expect(logger.error.mock.calls[0][0]).toContain("Invalid users involved")
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
    expect((res._body as any).message).toBe("Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix.")
    expect(checkoutService.transitionFromPending).not.toHaveBeenCalled()
  })

  it("charges the snapshot total and ignores transaction_amount", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 1, status: "pending" })

    await POST(makeReq({ ...cardBody, transaction_amount: 0.01 }), makeRes())

    expect(mockPaymentCreate.mock.calls[0][0].body.transaction_amount).toBe(104)
  })

  it("accepts a body without transaction_amount", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 1, status: "pending" })
    const { transaction_amount, ...body } = pixBody

    const res = makeRes()
    await POST(makeReq(body), res)

    expect(res._status).toBe(200)
    expect(mockPaymentCreate.mock.calls[0][0].body.transaction_amount).toBe(104)
  })

  it("404 when the snapshot does not exist", async () => {
    checkoutService.findByExternalReference.mockResolvedValue(null)

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: "Pedido não encontrado." })
    expect(mockPaymentCreate).not.toHaveBeenCalled()
  })

  it.each(["paid", "amount_mismatch"])("409 when the snapshot is %s", async (status) => {
    checkoutService.findByExternalReference.mockResolvedValue({
      payload: { total: 10400 },
      status,
    })

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(409)
    expect(res._body).toEqual({ error: "Este pedido já foi pago." })
    expect(mockPaymentCreate).not.toHaveBeenCalled()
  })

  it("marks paid when MP answers approved", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 123, status: "approved" })

    await POST(makeReq(cardBody), makeRes())

    expect(checkoutService.transitionFromPending).toHaveBeenCalledWith(
      "order-ref-uuid",
      "paid",
      "123"
    )
  })

  it.each(["pending", "rejected"])("does not mark on %s", async (status) => {
    mockPaymentCreate.mockResolvedValue({ id: 123, status })

    await POST(makeReq(cardBody), makeRes())

    expect(checkoutService.transitionFromPending).not.toHaveBeenCalled()
  })

  it("still answers 200 if the transition loses", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 123, status: "approved", status_detail: "accredited" })
    checkoutService.transitionFromPending.mockResolvedValue(false)

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(200)
    expect((res._body as any).payment_id).toBe(123)
    expect(logger.warn).toHaveBeenCalled()
  })

  it("still answers 200 and logs if the transition throws", async () => {
    mockPaymentCreate.mockResolvedValue({ id: 123, status: "approved", status_detail: "accredited" })
    checkoutService.transitionFromPending.mockRejectedValue(new Error("db down"))

    const res = makeRes()
    await POST(makeReq(cardBody), res)

    expect(res._status).toBe(200)
    expect((res._body as any).payment_id).toBe(123)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("[checkout/payment]"))
  })
})
