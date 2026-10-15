import { SELLER_MODULE } from "../../../../../modules/seller"
import { PUT } from "../route"

function makeReq(body: unknown) {
  const sellerService = { updateSellers: jest.fn(async ({ data }: any) => [{ id: "s1", ...data }]) }
  return { body, params: { id: "s1" }, scope: { resolve: (k: string) => (k === SELLER_MODULE ? sellerService : undefined) }, _svc: sellerService } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

describe("PUT /admin/sellers/:id — address", () => {
  it("lets the team fill in a seller's address", async () => {
    const req = makeReq({
      addressPostalCode: "44300-000", addressStreet: "Rua A", addressNumber: "1",
      addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
    })
    const res = makeRes()
    await PUT(req, res)
    expect(res._status).toBe(200)
    expect(req._svc.updateSellers.mock.calls[0][0].data.addressPostalCode).toBe("44300000")
  })

  it("rejects a partial address", async () => {
    const res = makeRes()
    await PUT(makeReq({ addressCity: "Cachoeira" }), res)
    expect(res._status).toBe(400)
  })
})
