import { MercadoPagoConfig, Preference } from "mercadopago"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("mercadopago")
jest.mock("crypto", () => ({ randomUUID: () => "fixed-uuid-1234" }))

const MockPreference = Preference as jest.MockedClass<typeof Preference>

import { POST } from "../route"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

const makeReq = (
  body: unknown,
  env: Record<string, string> = {},
  sellerByProductId: Record<string, string> = { "prod-1": "seller-1" }
) => {
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-token",
    STORE_CORS: "http://localhost:3000",
    BACKEND_URL: "",
    ...env,
  })
  const graph = jest.fn().mockResolvedValue({
    data: Object.entries(sellerByProductId).map(([id, sellerId]) => ({ id, seller: { id: sellerId } })),
  })
  return {
    body,
    scope: makeScope({ [ContainerRegistrationKeys.QUERY]: { graph } }),
    _graph: graph,
  } as any
}

const makeRes = () => {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const validBody = {
  items: [{ title: "Camiseta", quantity: 1, price: 7900, variantId: "var-1", productId: "prod-1" }],
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
  document: "111.444.777-35",
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

  it("returns 400 when document is missing", async () => {
    const { document, ...bodyWithoutDocument } = validBody
    const res = makeRes()
    await POST(makeReq(bodyWithoutDocument), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
  })

  it("returns 400 when document fails check-digit validation", async () => {
    const res = makeRes()
    await POST(makeReq({ ...validBody, document: "111.444.777-36" }), res)

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Dados inválidos.")
  })

  it("accepts a valid CNPJ as document", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const res = makeRes()
    await POST(makeReq({ ...validBody, document: "11.222.333/0001-81" }), res)

    expect(res._status).toBe(200)
  })

  it("includes buyer_document (clean digits) in the preference metadata", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.metadata.buyer_document).toBe("11144477735")
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

  it("returns 400 when an item's product has no seller association", async () => {
    const res = makeRes()
    await POST(makeReq(validBody, {}, {}), res) // sellerByProductId vazio → prod-1 não resolve

    expect(res._status).toBe(400)
    expect((res._body as any).error).toBe("Produto sem vendedor associado.")
  })

  it("writes seller_groups (not seller_id) to the preference metadata", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.metadata.seller_id).toBeUndefined()
    expect(body.metadata.seller_groups).toEqual([
      expect.objectContaining({ sellerId: "seller-1", subtotal: 7900 }),
    ])
  })

  it("splits seller_groups across sellers for a multi-seller cart", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    const body = {
      ...validBody,
      items: [
        { title: "Camiseta", quantity: 1, price: 7500, variantId: "var-1", productId: "prod-1" },
        { title: "Sabonete", quantity: 1, price: 2500, variantId: "var-2", productId: "prod-2" },
      ],
    }
    await POST(makeReq(body, {}, { "prod-1": "seller-1", "prod-2": "seller-2" }), makeRes())

    const created = mockPreferenceCreate.mock.calls[0][0].body
    expect(created.metadata.seller_groups).toHaveLength(2)
    expect(created.metadata.seller_groups.map((g: any) => g.sellerId).sort()).toEqual(["seller-1", "seller-2"])
  })

  it("still includes the flat items/shipping/total metadata used by the confirmation screen", async () => {
    mockPreferenceCreate.mockResolvedValue({ id: "pref-1" })

    await POST(makeReq(validBody), makeRes())

    const body = mockPreferenceCreate.mock.calls[0][0].body
    expect(body.metadata.items).toEqual([
      expect.objectContaining({ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }),
    ])
    expect(body.metadata.shipping).toEqual({ id: "pac", name: "PAC", price: 2500 })
    expect(body.metadata.total).toBe(10400)
  })
})
