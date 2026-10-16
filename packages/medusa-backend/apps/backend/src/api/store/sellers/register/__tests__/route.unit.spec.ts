import { SELLER_MODULE } from "../../../../../modules/seller"
import { POST } from "../route"

const base = {
  name: "Loja X", ownerName: "Ana", email: "ana@x.com", phone: "71999990000", cpfCnpj: "11144477735",
}
const address = {
  addressPostalCode: "40026010", addressStreet: "Largo Terreiro de Jesus", addressNumber: "10",
  addressDistrict: "Centro Histórico", addressCity: "Salvador", addressState: "BA",
}
function makeReq(body: unknown) {
  const sellerService = {
    listSellers: jest.fn().mockResolvedValue([]),
    createSellers: jest.fn(async (d: any) => ({ id: "s1", ...d })),
  }
  return { body, scope: { resolve: (k: string) => (k === SELLER_MODULE ? sellerService : undefined) }, _svc: sellerService } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("POST /store/sellers/register — address", () => {
  it("requires the shipping address", async () => {
    const res = makeRes()
    await POST(makeReq(base), res)
    expect(res._status).toBe(400)
  })

  it("stores the address with the new seller", async () => {
    const req = makeReq({ ...base, ...address })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(201)
    expect(req._svc.createSellers).toHaveBeenCalledWith(expect.objectContaining({ addressPostalCode: "40026010", status: "pending" }))
  })
})
