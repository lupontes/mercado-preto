import middlewareConfig, { storeResponseSanitizer } from "../middlewares"

describe("storeResponseSanitizer", () => {
  it("sends the body without pending_changes and calls next", () => {
    const sent: unknown[] = []
    const res: any = {
      json(body: unknown) {
        sent.push(body)
        return res
      },
    }
    const next = jest.fn()

    storeResponseSanitizer({ originalUrl: "/store/orders/x" } as any, res, next)
    const returned = res.json({
      order: {
        id: "x",
        items: [{ variant: { product: { id: "p", metadata: { pending_changes: { t: 1 }, k: 1 } } } }],
      },
    })

    expect(next).toHaveBeenCalledTimes(1)
    expect(returned).toBe(res)
    expect(sent).toEqual([
      { order: { id: "x", items: [{ variant: { product: { id: "p", metadata: { k: 1 } } } }] } },
    ])
  })

  it("is registered for every store route", () => {
    const store = middlewareConfig.routes!.find((r: any) => r.matcher === "/store/*") as any
    expect(store.middlewares).toContain(storeResponseSanitizer)
  })
})
