import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CHECKOUT_MODULE } from "../../../../../modules/checkout"

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto")
  return { ...actual, randomUUID: () => "fixed-uuid-1234" }
})

import { GET, POST } from "../route"

const validBody = {
  items: [
    { title: "Camiseta", quantity: 1, price: 7900, variantId: "var-1", productId: "prod-1" },
    { title: "Boné", quantity: 1, price: 5000, variantId: "var-2", productId: "prod-2" },
  ],
  address: {
    firstName: "João",
    lastName: "Silva",
    email: "joao@email.com",
    phone: "71999990000",
    cep: "44300-000",
    address1: "Rua das Flores",
    address2: "100",
    city: "Cachoeira",
    state: "BA",
  },
  shipping: { id: "pac", name: "PAC", price: 2500 },
  total: 15400,
  document: "111.444.777-35",
}

function makeReq(body: unknown = validBody, overrides: { recordSnapshot?: jest.Mock; createOrders?: jest.Mock } = {}) {
  const graph = jest.fn().mockResolvedValue({
    data: [
      { id: "prod-1", seller: { id: "seller-a" } },
      { id: "prod-2", seller: { id: "seller-b" } },
    ],
  })
  const checkoutService = { recordSnapshot: overrides.recordSnapshot ?? jest.fn().mockResolvedValue(undefined) }
  const orderService = {
    listOrders: jest.fn().mockResolvedValue([]),
    createOrders: overrides.createOrders ?? jest.fn(async (input: any[]) => input.map((_, i) => ({ id: `order-${i + 1}` }))),
  }
  const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        if (key === CHECKOUT_MODULE) return checkoutService
        if (key === Modules.ORDER) return orderService
        if (key === Modules.EVENT_BUS) return eventBus
        if (key === "logger") return logger
        throw new Error(`Unexpected resolve: ${key}`)
      },
    },
    _checkoutService: checkoutService,
    _orderService: orderService,
    _eventBus: eventBus,
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("/store/checkout/test-cash", () => {
  const original = { ...process.env }

  beforeEach(() => {
    process.env = { ...original }
    delete process.env.MARKETPLACE_SANDBOX
    // The route must work with MercadoPago completely unavailable.
    delete process.env.MERCADOPAGO_ACCESS_TOKEN
    process.env.TEST_CASH_PAYMENT_ENABLED = "true"
  })

  afterAll(() => {
    process.env = original
  })

  describe("GET", () => {
    it("reports enabled: true when the guard is on", async () => {
      const res = makeRes()
      await GET(makeReq(), res)
      expect(res._body).toEqual({ enabled: true })
    })

    it("reports enabled: false when the flag is absent", async () => {
      delete process.env.TEST_CASH_PAYMENT_ENABLED
      const res = makeRes()
      await GET(makeReq(), res)
      expect(res._body).toEqual({ enabled: false })
    })

    it("reports enabled: false in production mode even with the flag set", async () => {
      process.env.MARKETPLACE_SANDBOX = "false"
      const res = makeRes()
      await GET(makeReq(), res)
      expect(res._body).toEqual({ enabled: false })
    })
  })

  describe("POST", () => {
    it("returns 404 and creates nothing when the guard is off", async () => {
      delete process.env.TEST_CASH_PAYMENT_ENABLED
      const req = makeReq()
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(404)
      expect(req._checkoutService.recordSnapshot).not.toHaveBeenCalled()
      expect(req._orderService.createOrders).not.toHaveBeenCalled()
    })

    it("returns 404 in production mode even with the flag set", async () => {
      process.env.MARKETPLACE_SANDBOX = "false"
      const res = makeRes()
      await POST(makeReq(), res)
      expect(res._status).toBe(404)
    })

    it("returns 400 for an invalid payload", async () => {
      const req = makeReq({ ...validBody, items: [] })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(400)
      expect(req._orderService.createOrders).not.toHaveBeenCalled()
    })

    it("returns 400 when a product has no seller", async () => {
      const req = makeReq({ ...validBody, items: [{ ...validBody.items[0], productId: "prod-orphan" }] })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(400)
      expect(res._body).toEqual({ error: "Produto sem vendedor associado.", productId: "prod-orphan" })
    })

    it("records the snapshot and creates one test_cash order per seller, without MercadoPago credentials", async () => {
      const req = makeReq()
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(200)
      expect(res._body).toEqual({ external_reference: "fixed-uuid-1234" })
      expect(req._checkoutService.recordSnapshot).toHaveBeenCalledWith(
        "fixed-uuid-1234",
        expect.objectContaining({ buyer_document: "11144477735", total: 15400 })
      )
      const input = req._orderService.createOrders.mock.calls[0][0]
      expect(input.map((o: any) => o.metadata.seller_id)).toEqual(["seller-a", "seller-b"])
      for (const order of input) {
        expect(order.metadata).toEqual(
          expect.objectContaining({ payment_method: "test_cash", mercadopago_external_reference: "fixed-uuid-1234" })
        )
        expect(order.metadata).not.toHaveProperty("mercadopago_payment_id")
      }
      // Shipping split across both sellers sums to the full price.
      const shippingTotal = input.reduce((sum: number, o: any) => sum + o.shipping_methods[0].amount, 0)
      expect(shippingTotal).toBe(2500)
    })

    it("emits order.placed and test_cash.order_approved per order, never mercadopago.order_approved", async () => {
      const req = makeReq()
      await POST(req, makeRes())

      expect(req._eventBus.emit).toHaveBeenCalledWith([
        { name: "order.placed", data: { id: "order-1" } },
        { name: "test_cash.order_approved", data: { id: "order-1" } },
        { name: "order.placed", data: { id: "order-2" } },
        { name: "test_cash.order_approved", data: { id: "order-2" } },
      ])
      const names = req._eventBus.emit.mock.calls.flatMap((c: any[]) => c[0].map((e: any) => e.name))
      expect(names).not.toContain("mercadopago.order_approved")
    })

    it("returns 500 and emits nothing when the snapshot cannot be recorded", async () => {
      const req = makeReq(validBody, { recordSnapshot: jest.fn().mockRejectedValue(new Error("db down")) })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(500)
      expect(req._orderService.createOrders).not.toHaveBeenCalled()
      expect(req._eventBus.emit).not.toHaveBeenCalled()
    })

    it("returns 500 and emits nothing when order creation fails", async () => {
      const req = makeReq(validBody, { createOrders: jest.fn().mockRejectedValue(new Error("boom")) })
      const res = makeRes()

      await POST(req, res)

      expect(res._status).toBe(500)
      expect(req._eventBus.emit).not.toHaveBeenCalled()
    })
  })
})
