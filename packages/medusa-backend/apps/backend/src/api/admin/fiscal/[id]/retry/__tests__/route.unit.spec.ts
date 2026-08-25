import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeQuery(ncmByVariant: Record<string, string | undefined>) {
  return {
    graph: jest.fn().mockImplementation(async ({ filters }: any) => {
      const ncm = ncmByVariant[filters.id]
      return {
        data: [{ product: { categories: ncm ? [{ name: "BOLSAS", metadata: { ncm } }] : [] } }],
      }
    }),
  }
}

function makeReqRes(overrides: {
  doc?: any
  order?: any
  retryNfe?: jest.Mock
  ncmByVariant?: Record<string, string | undefined>
}) {
  const listNfDocuments = jest.fn().mockResolvedValue(overrides.doc ? [overrides.doc] : [])
  const retryNfe = overrides.retryNfe ?? jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
  const retrieveOrder = jest.fn().mockResolvedValue(overrides.order)

  const req = {
    params: { id: "doc-1" },
    scope: {
      resolve: (key: string) => {
        if (key === "fiscal") return { listNfDocuments, retryNfe }
        if (key === Modules.ORDER) return { retrieveOrder }
        if (key === ContainerRegistrationKeys.QUERY) return makeQuery(overrides.ncmByVariant ?? {})
        throw new Error(`Unexpected resolve: ${key}`)
      },
    },
  } as any

  const res = {
    _status: 200,
    _body: undefined as any,
    status(code: number) { this._status = code; return this },
    json(body: any) { this._body = body; return this },
  } as any

  return { req, res, listNfDocuments, retryNfe, retrieveOrder }
}

const baseDoc = { id: "doc-1", orderId: "order-1", amountCents: 5000 }
const baseOrder = {
  metadata: { buyer_document: "12345678909" },
  email: "buyer@test.com",
  shipping_address: {
    first_name: "Maria",
    last_name: "Testadora",
    address_1: "Rua Teste",
    address_2: "100",
    city: "Salvador",
    province: "BA",
    postal_code: "40000000",
  },
  items: [{ title: "Produto", quantity: 1, unit_price: 5000, variant_id: "variant-1" }],
}

describe("POST /admin/fiscal/:id/retry", () => {
  it("returns 404 when the document doesn't exist", async () => {
    const { req, res } = makeReqRes({})
    await POST(req, res)
    expect(res._status).toBe(404)
  })

  it("requests metadata/email in select so buyer_document/email aren't silently dropped", async () => {
    const { req, res, retrieveOrder } = makeReqRes({ doc: baseDoc, order: baseOrder })
    await POST(req, res)
    expect(retrieveOrder).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({ select: expect.arrayContaining(["metadata", "email"]) })
    )
  })

  it("passes the real buyer_document and buyerEmail from the order to retryNfe", async () => {
    const retryNfe = jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
    const { req, res } = makeReqRes({ doc: baseDoc, order: baseOrder, retryNfe })
    await POST(req, res)
    expect(retryNfe).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({ buyerDocument: "12345678909", buyerEmail: "buyer@test.com" })
    )
  })

  it("resolves NCM per item and sets ncmFallbackUsed: false when it resolves", async () => {
    const retryNfe = jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
    const { req, res } = makeReqRes({
      doc: baseDoc,
      order: baseOrder,
      retryNfe,
      ncmByVariant: { "variant-1": "42029200" },
    })
    await POST(req, res)
    expect(retryNfe).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        ncmFallbackUsed: false,
        items: [expect.objectContaining({ ncm: "42029200" })],
      })
    )
  })

  it("sets ncmFallbackUsed: true when no category NCM is found", async () => {
    const retryNfe = jest.fn().mockResolvedValue({ id: "doc-1", status: "issued" })
    const { req, res } = makeReqRes({
      doc: baseDoc,
      order: baseOrder,
      retryNfe,
      ncmByVariant: { "variant-1": undefined },
    })
    await POST(req, res)
    expect(retryNfe).toHaveBeenCalledWith("doc-1", expect.objectContaining({ ncmFallbackUsed: true }))
  })
})
