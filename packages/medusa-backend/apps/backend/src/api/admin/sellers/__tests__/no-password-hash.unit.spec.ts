import { GET as listSellers, POST as createSeller } from "../route"
import { GET as getSeller, PUT as updateSeller } from "../[id]/route"
import { POST as approve } from "../[id]/approve/route"
import { POST as reject } from "../[id]/reject/route"
import { POST as activate } from "../[id]/activate/route"
import { POST as suspend } from "../[id]/suspend/route"

// Every admin seller route must strip the hash, whatever the service returns.
const stored = {
  id: "seller_1", name: "Loja", ownerName: "Fulana", email: "a@b.com", phone: "71999999999",
  cpfCnpj: "52998224725", status: "pending", passwordHash: "salt:hash",
  addressPostalCode: "44300000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
}

const sellerService = {
  listSellers: jest.fn().mockResolvedValue([stored]),
  createSellers: jest.fn().mockResolvedValue(stored),
  updateSellers: jest.fn().mockResolvedValue([stored]),
  approveSeller: jest.fn().mockResolvedValue(stored),
  rejectSeller: jest.fn().mockResolvedValue(stored),
  activateSeller: jest.fn().mockResolvedValue(stored),
  suspendSeller: jest.fn().mockResolvedValue(stored),
}

function makeReq(body: unknown = {}, query: Record<string, string> = {}) {
  const services: Record<string, unknown> = {
    seller: sellerService,
    event_bus: { emit: jest.fn().mockResolvedValue(undefined) },
  }
  return { params: { id: "seller_1" }, body, query, scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const { passwordHash: _hash, id: _id, status: _status, ...createBody } = stored

describe("admin seller routes never return the password hash", () => {
  it.each([
    ["GET /admin/sellers", listSellers, makeReq()],
    ["POST /admin/sellers", createSeller, makeReq(createBody)],
    ["GET /admin/sellers/:id", getSeller, makeReq()],
    ["PUT /admin/sellers/:id", updateSeller, makeReq({ name: "Loja Nova" })],
    ["POST /admin/sellers/:id/approve", approve, makeReq()],
    ["POST /admin/sellers/:id/reject", reject, makeReq({ reason: "Faltam dados" })],
    ["POST /admin/sellers/:id/activate", activate, makeReq()],
    ["POST /admin/sellers/:id/suspend", suspend, makeReq({ reason: "Teste" })],
  ])("%s", async (_name, handler: any, req) => {
    const res = makeRes()
    await handler(req, res)

    expect(res._status).toBeLessThan(300)
    expect(JSON.stringify(res._body)).toContain("seller_1")
    expect(JSON.stringify(res._body)).not.toContain("passwordHash")
    expect(JSON.stringify(res._body)).not.toContain("salt:hash")
  })
})
