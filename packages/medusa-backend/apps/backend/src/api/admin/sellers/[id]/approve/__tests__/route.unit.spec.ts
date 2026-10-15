import { POST } from "../route"

const address = {
  addressPostalCode: "44300000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
}

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
    const listSellers = jest.fn().mockResolvedValue([{ id: "seller_1", status: "pending", ...address }])
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

describe("POST /admin/sellers/:id/approve — shipping address gate", () => {
  function makeGateReq(seller: Record<string, unknown>) {
    const sellerService = {
      listSellers: jest.fn().mockResolvedValue([seller]),
      approveSeller: jest.fn().mockResolvedValue({ id: "s1", status: "approved" }),
    }
    const eventBus = { emit: jest.fn() }
    return {
      params: { id: "s1" },
      scope: makeScope({ seller: sellerService, event_bus: eventBus }),
      _sellerService: sellerService,
    } as any
  }

  it("refuses to approve a seller without a complete shipping address", async () => {
    const req = makeGateReq({ id: "s1", status: "pending" })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe("Preencha o endereço de envio antes de aprovar")
    expect(req._sellerService.approveSeller).not.toHaveBeenCalled()
  })

  it("approves a seller with a complete address", async () => {
    const req = makeGateReq({ id: "s1", status: "pending", ...address })
    const res = makeRes()
    await POST(req, res)
    expect(res._status).toBe(200)
    expect(req._sellerService.approveSeller).toHaveBeenCalledWith("s1")
  })
})
