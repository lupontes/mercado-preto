import { MercadoPagoConfig, Preference } from "mercadopago"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CHECKOUT_MODULE } from "../../../../../modules/checkout"
import { resolveCheckoutShipping } from "../../../../../utils/checkout-shipping"
import { signLoyaltyToken } from "../../../../../utils/loyalty-token"

jest.mock("mercadopago")
jest.mock("../../../../../utils/checkout-shipping", () => ({ resolveCheckoutShipping: jest.fn() }))
jest.mock("../../../../../utils/melhor-envio", () => ({ getShippingCalculator: () => null }))

import { POST } from "../route"

const DOC = "11144477735"

// Two stores: var-1 (7900) from seller-1 and var-2 (4000) from seller-2.
function makeReq(body: unknown, loyaltyOverrides: Record<string, unknown> = {}) {
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
  process.env.STORE_CORS = "http://localhost:3000"
  process.env.JWT_SECRET = "test-secret"
  const graph = jest.fn(async ({ entity, filters }: any) => ({
    data:
      entity === "product_variant"
        ? filters.id.map((id: string) => ({
            id, product_id: id.replace("var-", "prod-"),
            prices: [{ amount: id === "var-1" ? 7900 : 4000, currency_code: "brl" }],
            product: { title: id },
          }))
        : filters.id.map((id: string) => ({ id, seller: { id: id === "prod-1" ? "seller-1" : "seller-2" } })),
  }))
  const checkout = { recordSnapshot: jest.fn().mockResolvedValue(undefined), attachPreferenceId: jest.fn().mockResolvedValue(undefined) }
  const loyalty = {
    availableBalance: jest.fn().mockResolvedValue(5000),
    reserve: jest.fn().mockResolvedValue(true),
    cancelReservation: jest.fn().mockResolvedValue(undefined),
    ...loyaltyOverrides,
  }
  const commission = { getCommissionRate: jest.fn().mockResolvedValue(15) }
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    [CHECKOUT_MODULE]: checkout,
    loyalty,
    commission,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }
  return { req: { body, scope: { resolve: (k: string) => services[k] } } as any, checkout, loyalty }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const option = {
  tier: "economico" as const, label: "Econômico", total: 2000, deliveryDays: 9,
  sellers: [
    { sellerId: "seller-1", sellerName: "A", tier: "economico" as const, service: "PAC" as const, serviceId: 1, price: 1000, deliveryDays: 9 },
    { sellerId: "seller-2", sellerName: "B", tier: "economico" as const, service: "PAC" as const, serviceId: 1, price: 1000, deliveryDays: 9 },
  ],
}

const body = (extra: Record<string, unknown> = {}) => ({
  items: [
    { title: "x", quantity: 1, price: 7900, variantId: "var-1", productId: "prod-1" },
    { title: "y", quantity: 1, price: 4000, variantId: "var-2", productId: "prod-2" },
  ],
  address: { firstName: "A", lastName: "B", email: "a@b.com", cep: "01310-100", address1: "Rua", number: "1", district: "Centro", city: "SP", state: "SP" },
  shipping: { tier: "economico", expectedTotal: 2000 },
  document: "111.444.777-35",
  ...extra,
})

describe("POST /store/checkout/preference with points", () => {
  let create: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    ;(resolveCheckoutShipping as jest.Mock).mockResolvedValue({ ok: true, option })
    create = jest.fn().mockResolvedValue({ id: "pref-1" })
    ;(Preference as jest.MockedClass<typeof Preference>).mockImplementation(() => ({ create } as any))
    ;(MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>).mockImplementation(() => ({} as any))
  })

  it("requires a loyalty token", async () => {
    const { req } = makeReq(body({ redeemPoints: 100 }))
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(401)
    expect(res._body).toEqual({ error: "Confirme seus pontos novamente." })
  })

  it("refuses a token confirmed for another document", async () => {
    process.env.JWT_SECRET = "test-secret"
    const { req } = makeReq(body({ redeemPoints: 100, loyaltyToken: signLoyaltyToken("52998224725") }))
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(401)
  })

  it("refuses more points than the balance", async () => {
    process.env.JWT_SECRET = "test-secret"
    const { req, loyalty } = makeReq(body({ redeemPoints: 80, loyaltyToken: signLoyaltyToken(DOC) }), { availableBalance: jest.fn().mockResolvedValue(50) })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Saldo de pontos insuficiente." })
    expect(loyalty.reserve).not.toHaveBeenCalled()
  })

  it("applies the discount, splits it per store and reserves the points", async () => {
    process.env.JWT_SECRET = "test-secret"
    const { req, checkout, loyalty } = makeReq(body({ redeemPoints: 300, loyaltyToken: signLoyaltyToken(DOC) }))
    const res = makeRes()
    await POST(req, res)

    const [ref, payload] = checkout.recordSnapshot.mock.calls[0]
    expect(payload.total).toBe(7900 + 4000 + 2000 - 300)
    expect(payload.loyalty_points).toBe(300)
    expect(payload.loyalty_discount).toBe(300)
    const shares = payload.seller_groups.map((g: any) => g.loyalty_discount)
    expect(shares.reduce((a: number, b: number) => a + b, 0)).toBe(300)
    expect(loyalty.reserve).toHaveBeenCalledWith(DOC, ref, 300)
    expect(res._body).toMatchObject({ pointsApplied: 300, discount: 300, total: 13600 })
  })

  it("caps the discount at the platform commission", async () => {
    process.env.JWT_SECRET = "test-secret"
    const { req, loyalty } = makeReq(body({ redeemPoints: 5000, loyaltyToken: signLoyaltyToken(DOC) }))
    const res = makeRes()
    await POST(req, res)

    // 15% of 11900 in items = 1785
    expect(loyalty.reserve).toHaveBeenCalledWith(DOC, expect.any(String), 1785)
    expect(res._body).toMatchObject({ pointsApplied: 1785, discount: 1785 })
  })

  it("charges one line with the discounted total, since MercadoPago has no negative items", async () => {
    process.env.JWT_SECRET = "test-secret"
    const { req } = makeReq(body({ redeemPoints: 300, loyaltyToken: signLoyaltyToken(DOC) }))
    await POST(req, makeRes())

    expect(create.mock.calls[0][0].body.items).toEqual([
      expect.objectContaining({ title: "Pedido Mercado Preto", quantity: 1, unit_price: 136, currency_id: "BRL" }),
    ])
  })

  it("answers insufficient balance when another checkout took the points first", async () => {
    process.env.JWT_SECRET = "test-secret"
    const { req } = makeReq(body({ redeemPoints: 300, loyaltyToken: signLoyaltyToken(DOC) }), { reserve: jest.fn().mockResolvedValue(false) })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it("releases the reservation when the preference cannot be created", async () => {
    process.env.JWT_SECRET = "test-secret"
    create.mockRejectedValue(new Error("mp down"))
    const { req, loyalty } = makeReq(body({ redeemPoints: 300, loyaltyToken: signLoyaltyToken(DOC) }))
    const res = makeRes()
    await POST(req, res)

    expect(res._status).toBe(500)
    expect(loyalty.cancelReservation).toHaveBeenCalledWith(loyalty.reserve.mock.calls[0][1])
  })

  it("keeps the itemized preference when no points are used", async () => {
    const { req, loyalty } = makeReq(body())
    await POST(req, makeRes())
    expect(create.mock.calls[0][0].body.items).toHaveLength(3)
    expect(loyalty.reserve).not.toHaveBeenCalled()
  })
})
