import { GET } from "../route"

function makeReq(query: Record<string, string>) {
  const service = { listAndCountNfDocuments: jest.fn().mockResolvedValue([Array.from({ length: 20 }, (_, i) => ({ id: `nf${i}` })), 45]) }
  return { req: { query, scope: { resolve: () => service } } as any, service }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /admin/fiscal", () => {
  it("returns the total count, not the page size", async () => {
    const { req } = makeReq({})
    const res = makeRes()
    await GET(req, res)

    expect((res._body as any).documents).toHaveLength(20)
    expect((res._body as any).count).toBe(45)
  })

  it("maps the query filters", async () => {
    const { req, service } = makeReq({ seller_id: "s1", status: "error", order_id: "o1", ncm_fallback_used: "true", limit: "5", offset: "10" })
    await GET(req, makeRes())

    expect(service.listAndCountNfDocuments).toHaveBeenCalledWith(
      { sellerId: "s1", status: "error", orderId: "o1", ncmFallbackUsed: true },
      expect.objectContaining({ take: 5, skip: 10 })
    )
  })
})
