import { PUT as adminUpdate } from "../[id]/route"
import { PATCH as sellerUpdate } from "../../../seller/me/route"
import sellerSearchIndex, { config } from "../../../../subscribers/seller-search-index"

function makeReq(emit: jest.Mock) {
  const services: Record<string, unknown> = {
    seller: { updateSellers: jest.fn(async ({ data }: any) => [{ id: "seller_1", ...data }]) },
    event_bus: { emit },
    logger: { error: jest.fn() },
  }
  return { params: { id: "seller_1" }, sellerId: "seller_1", body: { name: "Loja Nova" }, scope: { resolve: (k: string) => services[k] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("profile edits keep the store search current", () => {
  it.each([
    ["PUT /admin/sellers/:id", adminUpdate],
    ["PATCH /seller/me", sellerUpdate],
  ])("%s emits seller.updated", async (_name, handler: any) => {
    const emit = jest.fn().mockResolvedValue(undefined)
    await handler(makeReq(emit), makeRes())
    expect(emit).toHaveBeenCalledWith({ name: "seller.updated", data: { id: "seller_1" } })
  })

  it("saves the profile even when the event cannot be emitted", async () => {
    const emit = jest.fn(async () => { throw new Error("bus down") })
    const res = makeRes()
    await sellerUpdate(makeReq(emit), res)
    expect(res._status).toBe(200)
  })

  it("the seller index listens to profile updates", () => {
    expect(config.event).toContain("seller.updated")
    expect(typeof sellerSearchIndex).toBe("function")
  })
})
