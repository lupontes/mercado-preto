import { SELLER_MODULE } from "../../../../modules/seller"
import { PATCH } from "../route"

function makeReq(body: unknown) {
  const sellerService = { updateSellers: jest.fn(async ({ data }: any) => [{ id: "s1", ...data, passwordHash: "x" }]) }
  return { body, sellerId: "s1", scope: { resolve: (k: string) => (k === SELLER_MODULE ? sellerService : undefined) }, _svc: sellerService } as any
}
function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}
const address = {
  addressPostalCode: "44300-000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "ba",
}

describe("PATCH /seller/me — address", () => {
  it("saves a normalized address", async () => {
    const req = makeReq(address)
    const res = makeRes()
    await PATCH(req, res)
    expect(res._status).toBe(200)
    expect(req._svc.updateSellers).toHaveBeenCalledWith({
      selector: { id: "s1" },
      data: expect.objectContaining({ addressPostalCode: "44300000", addressState: "BA" }),
    })
    expect(res._body.seller.passwordHash).toBeUndefined()
  })

  it("rejects a partial address", async () => {
    const res = makeRes()
    await PATCH(makeReq({ addressPostalCode: "44300000" }), res)
    expect(res._status).toBe(400)
  })

  it("still accepts profile updates without address fields", async () => {
    const req = makeReq({ bio: "Olá" })
    const res = makeRes()
    await PATCH(req, res)
    expect(res._status).toBe(200)
    expect(req._svc.updateSellers.mock.calls[0][0].data).toEqual({ bio: "Olá" })
  })
})
