import { createMelhorEnvioCalculator, getShippingCalculator, mockShippingCalculator } from "../melhor-envio"

const input = {
  fromPostalCode: "44300000",
  toPostalCode: "01310100",
  products: [{ id: "var-1", weight: 0.5, length: 20, width: 15, height: 10, insuranceValue: 7700, quantity: 2 }],
}

function okFetch(body: unknown) {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
}

describe("createMelhorEnvioCalculator", () => {
  it("posts products in Melhor Envio units, only Correios PAC and SEDEX, to the sandbox host", async () => {
    const fetchImpl = okFetch([])
    await createMelhorEnvioCalculator({ token: "tok", sandbox: true, fetchImpl })(input)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate")
    expect(init.headers.Authorization).toBe("Bearer tok")
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      from: { postal_code: "44300000" },
      to: { postal_code: "01310100" },
      products: [{ id: "var-1", weight: 0.5, length: 20, width: 15, height: 10, insurance_value: 77, quantity: 2 }],
      services: "1,2",
    })
  })

  it("uses the production host outside sandbox", async () => {
    const fetchImpl = okFetch([])
    await createMelhorEnvioCalculator({ token: "tok", sandbox: false, fetchImpl })(input)
    expect(fetchImpl.mock.calls[0][0]).toBe("https://melhorenvio.com.br/api/v2/me/shipment/calculate")
  })

  it("maps PAC and SEDEX to cents and days, ignoring errored and non-Correios services", async () => {
    const fetchImpl = okFetch([
      { id: 1, name: "PAC", price: "36.79", custom_price: "36.79", delivery_time: 9, custom_delivery_time: 10, company: { name: "Correios" } },
      { id: 2, name: "SEDEX", error: "Serviço indisponível", company: { name: "Correios" } },
      { id: 3, name: ".Package", price: "27.19", delivery_time: 5, company: { name: "Jadlog" } },
    ])
    const quotes = await createMelhorEnvioCalculator({ token: "tok", sandbox: true, fetchImpl })(input)
    expect(quotes).toEqual([{ service: "PAC", serviceId: 1, price: 3679, deliveryDays: 10 }])
  })

  it("maps the packages of the response to label volumes", async () => {
    const fetchImpl = okFetch([
      {
        id: 1,
        name: "PAC",
        price: "36.79",
        delivery_time: 9,
        company: { name: "Correios" },
        packages: [{ weight: "0.5", dimensions: { height: 10, width: "15", length: 20 } }],
      },
    ])
    const quotes = await createMelhorEnvioCalculator({ token: "tok", sandbox: true, fetchImpl })(input)
    expect(quotes[0].packages).toEqual([{ weight: 0.5, length: 20, width: 15, height: 10 }])
  })

  it("drops services whose delivery time is missing or not a number", async () => {
    const fetchImpl = okFetch([
      { id: 1, name: "PAC", price: "36.79", delivery_time: null, company: { name: "Correios" } },
      { id: 2, name: "SEDEX", price: "60.00", delivery_time: "abc", company: { name: "Correios" } },
    ])
    const quotes = await createMelhorEnvioCalculator({ token: "tok", sandbox: true, fetchImpl })(input)
    expect(quotes).toEqual([])
  })

  it("throws on HTTP errors so the caller marks the seller as quote_failed", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthenticated." }) })
    await expect(createMelhorEnvioCalculator({ token: "bad", sandbox: true, fetchImpl })(input)).rejects.toThrow("401")
  })

  it("aborts after the timeout", async () => {
    const fetchImpl = jest.fn((_url: string, init: any) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))
    )
    await expect(
      createMelhorEnvioCalculator({ token: "tok", sandbox: true, timeoutMs: 10, fetchImpl: fetchImpl as any })(input)
    ).rejects.toThrow()
  })
})

describe("getShippingCalculator", () => {
  it("returns a real calculator when a token is set", () => {
    expect(getShippingCalculator({ MELHOR_ENVIO_TOKEN: "tok", NODE_ENV: "production" } as any)).toEqual(expect.any(Function))
  })
  it("returns the mock only in development without a token", () => {
    expect(getShippingCalculator({ NODE_ENV: "development" } as any)).toBe(mockShippingCalculator)
  })
  it("returns null without a token outside development", () => {
    expect(getShippingCalculator({ NODE_ENV: "production" } as any)).toBeNull()
  })
  it("treats a whitespace-only token as absent", () => {
    expect(getShippingCalculator({ MELHOR_ENVIO_TOKEN: "   ", NODE_ENV: "production" } as any)).toBeNull()
    expect(getShippingCalculator({ MELHOR_ENVIO_TOKEN: " \n", NODE_ENV: "development" } as any)).toBe(mockShippingCalculator)
  })
  it("sends the token without surrounding whitespace", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => [] } as any)
    try {
      await getShippingCalculator({ MELHOR_ENVIO_TOKEN: "  tok\n", NODE_ENV: "production" } as any)!(input)
      expect((fetchSpy.mock.calls[0][1] as any).headers.Authorization).toBe("Bearer tok")
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe("mockShippingCalculator", () => {
  it("returns PAC and SEDEX deterministically", async () => {
    const quotes = await mockShippingCalculator(input)
    expect(quotes.map((q) => q.service)).toEqual(["PAC", "SEDEX"])
    expect(quotes[0].price).toBeLessThan(quotes[1].price)
  })
})
