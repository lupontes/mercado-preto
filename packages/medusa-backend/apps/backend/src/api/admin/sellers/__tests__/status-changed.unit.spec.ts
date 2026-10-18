import { POST as activate } from "../[id]/activate/route"
import { POST as suspend } from "../[id]/suspend/route"
import { POST as reject } from "../[id]/reject/route"

const stored = { id: "seller_1", status: "active" }

function makeReq(body: unknown, emit: jest.Mock) {
  const services: Record<string, unknown> = {
    seller: {
      listSellers: jest.fn().mockResolvedValue([stored]),
      activateSeller: jest.fn().mockResolvedValue(stored),
      suspendSeller: jest.fn().mockResolvedValue(stored),
      rejectSeller: jest.fn().mockResolvedValue(stored),
    },
    event_bus: { emit },
  }
  return { params: { id: "seller_1" }, body, scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("admin status changes notify the search index", () => {
  it.each([
    ["activate", activate, {}],
    ["suspend", suspend, { reason: "Teste" }],
    ["reject", reject, { reason: "Faltam dados" }],
  ])("%s emits seller.status_changed", async (_name, handler: any, body) => {
    const emit = jest.fn().mockResolvedValue(undefined)
    await handler(makeReq(body, emit), makeRes())

    expect(emit).toHaveBeenCalledWith({ name: "seller.status_changed", data: { id: "seller_1" } })
  })
})
