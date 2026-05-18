import { MercadoPagoConfig, Preference } from "mercadopago"

jest.mock("mercadopago")
jest.mock("crypto", () => ({ randomUUID: () => "fixed-uuid-1234" }))

const MockPreference = Preference as jest.MockedClass<typeof Preference>

import { POST } from "../route"

const makeReq = (body: unknown, env: Record<string, string> = {}) => {
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-token",
    STORE_CORS: "http://localhost:3000",
    BACKEND_URL: "",
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

const validBody = {
  items: [{ title: "Camiseta", quantity: 1, price: 7900, variantId: "var-1" }],
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
  total: 10400,
  sellerId: "seller-1",
}

describe("POST /store/checkout/preference", () => {
  let mockPreferenceCreate: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockPreferenceCreate = jest.fn()
    MockPreference.mockImplementation(() => ({ create: mockPreferenceCreate } as any))
    ;(MercadoPagoConfig as jest.MockedClass<typeof MercadoPagoConfig>).mockImplementation(() => ({} as any))
  })

  it("returns preference_id and URLs for a valid request", async () => {
    mockPreferenceCreate.mockResolvedValue({
      id: "pref-abc",
      init_point: "https://mp.com/pay",
      sandbox_init_point: "https://sandbox.mp.com/pay",
    })

    const res = makeRes()
    await POST(makeReq(validBody), res)

    expect(res._status).toBe(200)
    expect(res._body).toEqual({
      preference_id: "pref-abc",
      init_point: "https://mp.com/pay",
      sandbox_init_point: "https://sandbox.mp.com/pay",
      external_reference: "fixed-uuid-1234",
    })
  })

  it("converts item prices from cents to reais", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    const itemPrices = body.items.map((i: any) => i.unit_price)
    expect(itemPrices).toContain(79)
    expect(itemPrices).toContain(25)
  })

  it("includes shipping as a separate item when price > 0", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    const shippingItem = body.items.find((i: any) => i.id.startsWith("frete-"))
    expect(shippingItem).toBeDefined()
    expect(shippingItem.unit_price).toBe(25)
  })

  it("omits shipping item when price is 0", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const body = { ...validBody, shipping: { id: "retirada", name: "Retirada", price: 0 } }
    await POST(makeReq(body), makeRes())

    const reqBody = mockPreferenceCreate.mock.calls[0][0].body
    const shippingItem = reqBody.items.find((i: any) => i.id.startsWith("frete-"))
    expect(shippingItem).toBeUndefined()
  })

  it("omits auto_return when STORE_CORS is HTTP", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody, { STORE_CORS: "http://localhost:3000" }), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.auto_return).toBeUndefined()
  })

  it("sets auto_return when STORE_CORS is HTTPS", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody, { STORE_CORS: "https://mercadopreto.com.br" }), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.auto_return).toBe("approved")
  })

  it("includes notification_url when BACKEND_URL is set", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(
      makeReq(validBody, { BACKEND_URL: "https://abc.ngrok.io" }),
      makeRes()
    )

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.notification_url).toBe("https://abc.ngrok.io/webhooks/mercadopago")
  })

  it("returns 400 when body fails schema validation", async () => {
    const res = makeRes()
    await POST(makeReq({ items: [] }), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
  })

  it("returns 503 when MERCADOPAGO_ACCESS_TOKEN is not set", async () => {
    const res = makeRes()
    await POST(makeReq(validBody, { MERCADOPAGO_ACCESS_TOKEN: "" }), res)

    expect(res._status).toBe(503)
  })

  it("returns 500 when the MP SDK throws", async () => {
    mockPreferenceCreate.mockRejectedValue(new Error("MP unavailable"))

    const res = makeRes()
    await POST(makeReq(validBody), res)

    expect(res._status).toBe(500)
    expect((res._body as any).detail).toBe("MP unavailable")
  })
})
