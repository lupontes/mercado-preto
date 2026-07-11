import { MercadoPagoConfig, Payment, Preference } from "mercadopago"

jest.mock("mercadopago")
jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto")
  return { ...actual, randomUUID: () => "fixed-uuid" }
})

const MockPayment = Payment as jest.MockedClass<typeof Payment>
const MockPreference = Preference as jest.MockedClass<typeof Preference>
;(MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>).mockImplementation(() => ({} as any))

import { POST } from "../route"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_TEST_SECRET = "test-secret"

function makeValidSignature(body: unknown, secret: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto")
  const dataId = (body as any)?.data?.id ?? ""
  const ts = "1000000000"
  const requestId = "test-request-id"
  const message = `id:${dataId};request-id:${requestId};ts:${ts};`
  const v1 = crypto.createHmac("sha256", secret).update(message).digest("hex")
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId }
}

function makeReq(body: unknown, secret = WEBHOOK_TEST_SECRET) {
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret

  const mockOrderService = {
    createOrders: jest.fn().mockResolvedValue([{ id: "order-1" }]),
    listOrders: jest.fn().mockResolvedValue([]),
  }
  const mockEventBusService = {
    emit: jest.fn().mockResolvedValue(undefined),
  }
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  return {
    body,
    headers: secret ? makeValidSignature(body, secret) : {},
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return mockLogger
        if (key.includes("order")) return mockOrderService
        if (key.includes("event")) return mockEventBusService
        return {}
      },
    },
    _orderService: mockOrderService,
    _eventBusService: mockEventBusService,
  } as any
}

function makeRes() {
  const res = { _status: 200 } as any
  res.sendStatus = (code: number) => { res._status = code; return res }
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const approvedPayment = {
  id: 42,
  status: "approved",
  transaction_amount: 79,
  external_reference: "ext-ref-uuid",
  metadata: {},
  payer: { email: "buyer@test.com", name: "João", surname: "Silva", phone: {}, address: {} },
}

const preferenceMetadata = {
  address: {
    first_name: "João",
    last_name: "Silva",
    email: "buyer@test.com",
    phone: "71999990000",
    address_1: "Rua das Flores",
    address_2: "100",
    city: "Cachoeira",
    state: "BA",
    postal_code: "44300000",
  },
  items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }],
  shipping: { id: "pac", name: "PAC", price: 1500 },
  total: 9400,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /webhooks/mercadopago", () => {
  let mockPaymentGet: jest.Mock
  let mockPrefSearch: jest.Mock
  let mockPrefGet: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockPaymentGet = jest.fn()
    mockPrefSearch = jest.fn()
    mockPrefGet = jest.fn()

    MockPayment.mockImplementation(() => ({ get: mockPaymentGet } as any))
    MockPreference.mockImplementation(() => ({ search: mockPrefSearch, get: mockPrefGet } as any))
  })

  it("returns 200 without creating order for non-payment notification", async () => {
    const req = makeReq({ type: "subscription", data: { id: "1" } })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("returns 200 without creating order when payment is not approved", async () => {
    mockPaymentGet.mockResolvedValue({ ...approvedPayment, status: "pending" })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
    expect(req._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("creates order using preference metadata when payment.metadata has no items", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(mockPrefSearch).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ external_reference: "ext-ref-uuid" }) })
    )
    expect(mockPrefGet).toHaveBeenCalledWith({ preferenceId: "pref-123" })
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: [expect.objectContaining({ title: "Camiseta", quantity: 1, unit_price: 7900 })],
        }),
      ])
    )
  })

  it("uses payment.metadata directly when it already has items", async () => {
    const paymentWithItems = {
      ...approvedPayment,
      metadata: preferenceMetadata,
    }
    mockPaymentGet.mockResolvedValue(paymentWithItems)

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(mockPrefSearch).not.toHaveBeenCalled()
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: [expect.objectContaining({ unit_price: 7900 })],
        }),
      ])
    )
  })

  it("stores unit_price in centavos (no /100 conversion)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrder] = req._orderService.createOrders.mock.calls[0][0]
    expect(createdOrder.items[0].unit_price).toBe(7900)
    expect(createdOrder.items[0].unit_price).not.toBe(79)
  })

  it("stores shipping amount in centavos (no /100 conversion)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrder] = req._orderService.createOrders.mock.calls[0][0]
    expect(createdOrder.shipping_methods[0].amount).toBe(1500)
    expect(createdOrder.shipping_methods[0].amount).not.toBe(15)
  })

  it("creates order with empty items when preference fetch fails", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockRejectedValue(new Error("MP unavailable"))

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ items: [] }),
      ])
    )
  })

  it("creates order with empty items when preference search returns no results", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [] })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(mockPrefGet).not.toHaveBeenCalled()
    expect(req._orderService.createOrders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ items: [] }),
      ])
    )
  })

  it("emits order.placed and mercadopago.order_approved after order creation", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    expect(req._eventBusService.emit).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "order.placed", data: { id: "order-1" } }),
        expect.objectContaining({ name: "mercadopago.order_approved", data: { id: "order-1" } }),
      ])
    )
  })

  it("returns 200 even when an unexpected error occurs", async () => {
    mockPaymentGet.mockRejectedValue(new Error("network error"))

    const req = makeReq({ type: "payment", data: { id: "42" } })
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
  })

  it("returns 401 when signature verification fails", async () => {
    const req = makeReq({ type: "payment", data: { id: "42" } }, "my-secret")
    req.headers = { "x-signature": "ts=123,v1=invalidsig", "x-request-id": "req-1" }
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(401)
  })
})
