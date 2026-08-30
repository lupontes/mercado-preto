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

// Mirrors the official signature spec: dataId comes from the query string
// (lowercased), and any part whose value is absent is omitted entirely.
function makeValidSignature(dataId: string, secret: string, requestId: string | undefined = "test-request-id") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto")
  const ts = "1000000000"
  const parts: string[] = []
  if (dataId) parts.push(`id:${dataId.toLowerCase()}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${ts}`)
  const message = parts.join(";") + ";"
  const v1 = crypto.createHmac("sha256", secret).update(message).digest("hex")
  const headers: Record<string, string> = { "x-signature": `ts=${ts},v1=${v1}` }
  if (requestId) headers["x-request-id"] = requestId
  return headers
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

  const dataId = (body as any)?.data?.id ?? ""

  return {
    body,
    query: { "data.id": dataId },
    headers: secret ? makeValidSignature(dataId, secret) : {},
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
  seller_id: "seller-abc",
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

  it("propagates seller_id from preference metadata into the created order's metadata", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrder] = req._orderService.createOrders.mock.calls[0][0]
    expect(createdOrder.metadata.seller_id).toBe("seller-abc")
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

  it("validates signature when x-request-id is absent (manifest omits the segment, doesn't leave it empty)", async () => {
    mockPaymentGet.mockResolvedValue({ ...approvedPayment, status: "pending" })

    const body = { type: "payment", data: { id: "42" } }
    const req = makeReq(body, "my-secret")
    req.headers = makeValidSignature("42", "my-secret", undefined)
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(200)
  })

  it("rejects a signature computed with the old (buggy) always-include-request-id manifest", async () => {
    // Regression guard: id:42;request-id:;ts:...; (old bug) must NOT validate
    // against the correct manifest id:42;ts:...; (request-id omitted).
    const crypto = require("crypto") as typeof import("crypto")
    const ts = "1000000000"
    const buggyMessage = `id:42;request-id:;ts:${ts};`
    const v1 = crypto.createHmac("sha256", "my-secret").update(buggyMessage).digest("hex")

    const req = makeReq({ type: "payment", data: { id: "42" } }, "my-secret")
    req.headers = { "x-signature": `ts=${ts},v1=${v1}` }
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(401)
  })

  const twoSellerGroupsMetadata = {
    address: preferenceMetadata.address,
    seller_groups: [
      {
        sellerId: "seller-a",
        subtotal: 7500,
        shippingShare: 1125,
        items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7500 }],
      },
      {
        sellerId: "seller-b",
        subtotal: 2500,
        shippingShare: 375,
        items: [{ variant_id: "var-2", title: "Sabonete", quantity: 1, price: 2500 }],
      },
    ],
    shipping: { id: "pac", name: "PAC", price: 1500 },
    total: 11500,
  }

  it("creates one order per seller group when seller_groups is present", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.createOrders.mockResolvedValue([{ id: "order-a" }, { id: "order-b" }])

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders).toHaveLength(2)
    expect(createdOrders.map((o: any) => o.metadata.seller_id).sort()).toEqual(["seller-a", "seller-b"])
    expect(createdOrders.find((o: any) => o.metadata.seller_id === "seller-a").shipping_methods[0].amount).toBe(1125)
    expect(createdOrders.find((o: any) => o.metadata.seller_id === "seller-b").shipping_methods[0].amount).toBe(375)
  })

  it("emits order.placed and mercadopago.order_approved once per created order", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.createOrders.mockResolvedValue([{ id: "order-a" }, { id: "order-b" }])

    await POST(req, makeRes())

    expect(req._eventBusService.emit).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "order.placed", data: { id: "order-a" } }),
        expect.objectContaining({ name: "mercadopago.order_approved", data: { id: "order-a" } }),
        expect.objectContaining({ name: "order.placed", data: { id: "order-b" } }),
        expect.objectContaining({ name: "mercadopago.order_approved", data: { id: "order-b" } }),
      ])
    )
  })

  it("only creates orders for seller groups that don't already exist (partial idempotency)", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.listOrders.mockImplementation((filter: any) => {
      const sellerId = filter.metadata.seller_id
      return Promise.resolve(sellerId === "seller-a" ? [{ id: "order-a-existing" }] : [])
    })
    req._orderService.createOrders.mockResolvedValue([{ id: "order-b" }])

    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders).toHaveLength(1)
    expect(createdOrders[0].metadata.seller_id).toBe("seller-b")
  })

  it("skips order creation entirely when every seller group's order already exists", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: twoSellerGroupsMetadata })

    const req = makeReq({ type: "payment", data: { id: "42" } })
    req._orderService.listOrders.mockResolvedValue([{ id: "existing" }])

    const res = makeRes()
    await POST(req, res)

    expect(req._orderService.createOrders).not.toHaveBeenCalled()
    expect(res._status).toBe(200)
  })

  it("falls back to a single group derived from seller_id/items/shipping when seller_groups is absent", async () => {
    mockPaymentGet.mockResolvedValue(approvedPayment)
    mockPrefSearch.mockResolvedValue({ elements: [{ id: "pref-123" }] })
    mockPrefGet.mockResolvedValue({ metadata: preferenceMetadata }) // sem seller_groups, tem seller_id: "seller-abc"

    const req = makeReq({ type: "payment", data: { id: "42" } })
    await POST(req, makeRes())

    const [createdOrders] = req._orderService.createOrders.mock.calls[0]
    expect(createdOrders).toHaveLength(1)
    expect(createdOrders[0].metadata.seller_id).toBe("seller-abc")
  })
})
