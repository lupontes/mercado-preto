import middlewareConfig, { storeFieldsGuard } from "../middlewares"

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("storeFieldsGuard", () => {
  it("answers 400 naming the token when a private seller field is requested", () => {
    const req = { query: { fields: "id,+seller.addressState,+seller.cpfCnpj,+seller.email" } } as any
    const res = makeRes()
    const next = jest.fn()

    storeFieldsGuard(req, res, next)

    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Campo não permitido: +seller.addressState" })
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects a wildcard on the seller relation", () => {
    const res = makeRes()
    const next = jest.fn()
    storeFieldsGuard({ query: { fields: "*seller" } } as any, res, next)
    expect(res._status).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })

  it("lets the storefront product page request through", () => {
    const res = makeRes()
    const next = jest.fn()
    storeFieldsGuard({ query: { fields: "*variants.prices,+seller.name,+seller.phone" } } as any, res, next)
    expect(next).toHaveBeenCalled()
    expect(res._status).toBe(200)
  })

  it("lets requests without query or fields through", () => {
    const next = jest.fn()
    storeFieldsGuard({ query: {} } as any, makeRes(), next)
    storeFieldsGuard({} as any, makeRes(), next)
    expect(next).toHaveBeenCalledTimes(2)
  })

  it("is registered for every /store route", () => {
    const route = (middlewareConfig as any).routes.find((r: any) => r.middlewares?.includes(storeFieldsGuard))
    expect(route).toBeDefined()
    expect(route.matcher).toBe("/store/*")
    expect(route.method ?? route.methods).toBeUndefined()
  })
})
