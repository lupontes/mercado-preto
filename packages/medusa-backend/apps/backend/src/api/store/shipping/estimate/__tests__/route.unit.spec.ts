import { GET } from "../route"

const makeReq = (query: Record<string, string>, env: Record<string, string> = {}) => {
  Object.assign(process.env, {
    MELHOR_ENVIO_TOKEN: "",
    MELHOR_ENVIO_ORIGIN_CEP: "44300000",
    NODE_ENV: "development",
    ...env,
  })
  return { query } as any
}

const makeRes = () => {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

beforeEach(() => {
  global.fetch = jest.fn()
})

describe("GET /store/shipping/estimate", () => {
  describe("validation", () => {
    it("returns 400 when cep is missing", async () => {
      const res = makeRes()
      await GET(makeReq({}), res)
      expect(res._status).toBe(400)
    })

    it("returns 400 for a 7-digit cep", async () => {
      const res = makeRes()
      await GET(makeReq({ cep: "4430000" }), res)
      expect(res._status).toBe(400)
    })

    it("returns 400 for a cep with letters", async () => {
      const res = makeRes()
      await GET(makeReq({ cep: "ABCDEFGH" }), res)
      expect(res._status).toBe(400)
    })

    it("accepts a formatted cep like 01310-100", async () => {
      const res = makeRes()
      await GET(makeReq({ cep: "01310-100" }), res)
      expect(res._status).toBe(200)
    })
  })

  describe("fallback (no token)", () => {
    it("returns mock rates when MELHOR_ENVIO_TOKEN is empty", async () => {
      const res = makeRes()
      await GET(makeReq({ cep: "01310100" }), res)

      expect(res._status).toBe(200)
      expect((res._body as any)._mock).toBe(true)
      expect((res._body as any).rates.length).toBeGreaterThan(0)
    })

    it("returns PAC and SEDEX in fallback rates", async () => {
      const res = makeRes()
      await GET(makeReq({ cep: "01310100" }), res)

      const ids = (res._body as any).rates.map((r: any) => r.id)
      expect(ids).toContain("pac")
      expect(ids).toContain("sedex")
    })

    it("returns prices in centavos in fallback", async () => {
      const res = makeRes()
      await GET(makeReq({ cep: "01310100" }), res)

      const rates = (res._body as any).rates as Array<{ price: number }>
      rates.forEach((r) => {
        expect(r.price).toBeGreaterThan(100)
      })
    })

    it("does not call Melhor Envio API when token is empty", async () => {
      await GET(makeReq({ cep: "01310100" }), makeRes())
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe("Melhor Envio API (with token)", () => {
    const withToken = { MELHOR_ENVIO_TOKEN: "test-jwt-token" }

    it("calls sandbox URL in development", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([{ id: 1, name: "PAC", company: { name: "Correios" }, price: "12.50", delivery_time: 7 }]),
      })

      await GET(makeReq({ cep: "01310100" }, { ...withToken, NODE_ENV: "development" }), makeRes())

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
      expect(calledUrl).toContain("sandbox.melhorenvio.com.br")
    })

    it("calls production URL in production", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      })

      await GET(makeReq({ cep: "01310100" }, { ...withToken, NODE_ENV: "production" }), makeRes())

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
      expect(calledUrl).toContain("melhorenvio.com.br")
      expect(calledUrl).not.toContain("sandbox")
    })

    it("includes Authorization header with Bearer token", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      })

      await GET(makeReq({ cep: "01310100" }, withToken), makeRes())

      const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers
      expect(headers.Authorization).toBe("Bearer test-jwt-token")
    })

    it("converts price from reais to centavos", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([
          { id: 1, name: "PAC", company: { name: "Correios" }, price: "15.90", delivery_time: 8 },
        ]),
      })

      const res = makeRes()
      await GET(makeReq({ cep: "01310100" }, withToken), res)

      const rates = (res._body as any).rates as Array<{ price: number }>
      expect(rates[0].price).toBe(1590)
    })

    it("filters out services with errors", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([
          { id: 1, name: "PAC", company: { name: "Correios" }, price: "15.90", delivery_time: 8 },
          { id: 2, name: "SEDEX", error: "CEP não atendido", price: null },
        ]),
      })

      const res = makeRes()
      await GET(makeReq({ cep: "01310100" }, withToken), res)

      const rates = (res._body as any).rates as Array<{ name: string }>
      expect(rates).toHaveLength(1)
      expect(rates[0].name).toBe("PAC")
    })

    it("falls back to mock rates when Melhor Envio returns non-ok status", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false })

      const res = makeRes()
      await GET(makeReq({ cep: "01310100" }, withToken), res)

      expect((res._body as any)._mock).toBe(true)
    })

    it("falls back to mock rates on network error", async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"))

      const res = makeRes()
      await GET(makeReq({ cep: "01310100" }, withToken), res)

      expect((res._body as any)._mock).toBe(true)
    })

    it("sends origin CEP from env in request body", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      })

      await GET(
        makeReq({ cep: "01310100" }, { ...withToken, MELHOR_ENVIO_ORIGIN_CEP: "30140071" }),
        makeRes()
      )

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
      expect(body.from.postal_code).toBe("30140071")
    })
  })
})
