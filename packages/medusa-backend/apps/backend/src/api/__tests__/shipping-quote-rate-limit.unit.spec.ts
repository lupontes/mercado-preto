import middlewareConfig, { shippingQuoteRateLimit } from "../middlewares"

function makeRes() {
  const res = { statusCode: 200, _body: undefined as unknown, headersSent: false, headers: {} as Record<string, unknown> } as any
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v }
  res.getHeader = (k: string) => res.headers[k]
  res.append = res.setHeader
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.send = (body: unknown) => { res._body = body; return res }
  res.on = () => res
  return res
}

async function hit(ip: string) {
  const req = { ip, headers: { "x-forwarded-for": ip }, method: "POST", app: { get: () => false } } as any
  const res = makeRes()
  const next = jest.fn()
  await shippingQuoteRateLimit(req, res, next)
  return { res, next }
}

describe("shipping quote rate limit", () => {
  it("is applied to /store/shipping/quote", () => {
    const route = middlewareConfig.routes?.find((r: any) => r.matcher === "/store/shipping/quote")
    expect(route?.middlewares).toContain(shippingQuoteRateLimit)
  })

  it("lets 30 quotes per minute through and answers 429 to the next one from the same IP", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await hit("203.0.113.7")).next).toHaveBeenCalled()
    }
    const blocked = await hit("203.0.113.7")
    expect(blocked.next).not.toHaveBeenCalled()
    expect(blocked.res.statusCode).toBe(429)
    expect(blocked.res._body).toEqual({ error: "Muitas cotações de frete. Aguarde um minuto e tente novamente." })

    // Another buyer is not affected.
    expect((await hit("203.0.113.8")).next).toHaveBeenCalled()
  })
})
