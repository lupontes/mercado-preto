import { POST } from "../route"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /admin/sellers/:id/approve", () => {
  it("approves a pending seller and emits seller.approved", async () => {
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", status: "pending" }])
    const approveSeller = jest.fn().mockResolvedValue({ id: "seller_1", status: "approved" })
    const emit = jest.fn().mockResolvedValue(undefined)
    const req = {
      params: { id: "seller_1" },
      scope: makeScope({
        seller: { listSellers, approveSeller },
        event_bus: { emit },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(approveSeller).toHaveBeenCalledWith("seller_1")
    expect(emit).toHaveBeenCalledWith({ name: "seller.approved", data: { id: "seller_1" } })
    expect(res._status).toBe(200)
    expect(res._body).toEqual({ seller: { id: "seller_1", status: "approved" } })
  })

  it("returns 404 when the seller does not exist", async () => {
    const listSellers = jest.fn().mockResolvedValue([])
    const approveSeller = jest.fn()
    const emit = jest.fn()
    const req = {
      params: { id: "seller_missing" },
      scope: makeScope({
        seller: { listSellers, approveSeller },
        event_bus: { emit },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: "Vendedor não encontrado" })
    expect(approveSeller).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
