import { GET } from "../route"

function makeReq(docs: unknown[]) {
  return { params: { id: "nf1" }, scope: { resolve: () => ({ listNfDocuments: jest.fn().mockResolvedValue(docs) }) } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /admin/fiscal/:id", () => {
  it("answers 404 for an unknown document", async () => {
    const res = makeRes()
    await GET(makeReq([]), res)
    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: "Documento não encontrado" })
  })

  it("returns the document", async () => {
    const res = makeRes()
    await GET(makeReq([{ id: "nf1", status: "authorized" }]), res)
    expect(res._body).toEqual({ document: { id: "nf1", status: "authorized" } })
  })
})
