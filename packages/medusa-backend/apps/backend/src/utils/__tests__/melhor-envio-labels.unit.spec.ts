import { createLabelClient, getLabelClient, MelhorEnvioError } from "../melhor-envio-labels"

function okFetch(body: unknown) {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
}

function client(fetchImpl: jest.Mock, sandbox = true) {
  return createLabelClient({ token: "secret-tok", sandbox, fetchImpl })
}

describe("createLabelClient", () => {
  it("addToCart posts the body to the sandbox cart and returns the price in cents", async () => {
    const fetchImpl = okFetch({ id: "abc", price: "21.50" })
    const result = await client(fetchImpl).addToCart({ service: 1 })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://sandbox.melhorenvio.com.br/api/v2/me/cart")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer secret-tok")
    expect(JSON.parse(init.body)).toEqual({ service: 1 })
    expect(result).toEqual({ id: "abc", price: 2150 })
  })

  it("uses the production host outside sandbox", async () => {
    const fetchImpl = okFetch({ id: "abc", price: 1 })
    await client(fetchImpl, false).addToCart({})
    expect(fetchImpl.mock.calls[0][0]).toBe("https://melhorenvio.com.br/api/v2/me/cart")
  })

  it.each([
    ["checkout", "/me/shipment/checkout"],
    ["generate", "/me/shipment/generate"],
  ] as const)("%s posts the order ids", async (method, path) => {
    const fetchImpl = okFetch({})
    await client(fetchImpl)[method](["a", "b"])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://sandbox.melhorenvio.com.br/api/v2${path}`)
    expect(JSON.parse(init.body)).toEqual({ orders: ["a", "b"] })
  })

  it("printUrl posts the order ids in private mode and returns the url", async () => {
    const fetchImpl = okFetch({ url: "https://me.example/print/1" })
    const url = await client(fetchImpl).printUrl(["a"])
    const [reqUrl, init] = fetchImpl.mock.calls[0]
    expect(reqUrl).toBe("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/print")
    expect(JSON.parse(init.body)).toEqual({ mode: "private", orders: ["a"] })
    expect(url).toBe("https://me.example/print/1")
  })

  it("tracking maps the response by label id, with nulls for missing fields", async () => {
    const fetchImpl = okFetch({
      a: { status: "posted", tracking: "AA123BR", posted_at: "2026-10-20 10:00:00", delivered_at: null },
      b: { status: "released" },
    })
    const result = await client(fetchImpl).tracking(["a", "b"])
    expect(fetchImpl.mock.calls[0][0]).toBe("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/tracking")
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ orders: ["a", "b"] })
    expect(result).toEqual({
      a: { status: "posted", trackingCode: "AA123BR", postedAt: "2026-10-20 10:00:00", deliveredAt: null },
      b: { status: "released", trackingCode: null, postedAt: null, deliveredAt: null },
    })
  })

  it("cancel posts the order with the fixed reason", async () => {
    const fetchImpl = okFetch({})
    await client(fetchImpl).cancel("abc")
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/cancel")
    expect(JSON.parse(init.body)).toEqual({ order: { id: "abc", reason_id: "2", description: "Pedido cancelado" } })
  })

  it("throws MelhorEnvioError with status and body, never leaking the token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 422, text: async () => '{"message":"saldo insuficiente"}' })
    const err: MelhorEnvioError = await client(fetchImpl).checkout(["a"]).then(
      () => {
        throw new Error("should have thrown")
      },
      (e) => e,
    )
    expect(err).toBeInstanceOf(MelhorEnvioError)
    expect(err.status).toBe(422)
    expect(err.body).toBe('{"message":"saldo insuficiente"}')
    expect(err.message).toContain("422")
    expect(err.message).not.toContain("secret-tok")
  })

  it("aborts after the timeout", async () => {
    const fetchImpl = jest.fn((_url: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))))
    await expect(createLabelClient({ token: "t", sandbox: true, timeoutMs: 10, fetchImpl: fetchImpl as any }).checkout(["a"])).rejects.toThrow("aborted")
  })
})

describe("getLabelClient", () => {
  it("returns null without a token", () => {
    expect(getLabelClient({})).toBeNull()
    expect(getLabelClient({ MELHOR_ENVIO_TOKEN: "  " })).toBeNull()
  })

  it("trims the token and defaults to sandbox; MARKETPLACE_SANDBOX=false selects production", async () => {
    const fetchImpl = okFetch({ id: "x", price: 1 })
    const original = global.fetch
    global.fetch = fetchImpl as any
    try {
      await getLabelClient({ MELHOR_ENVIO_TOKEN: " tok\n" })!.addToCart({})
      await getLabelClient({ MELHOR_ENVIO_TOKEN: "tok", MARKETPLACE_SANDBOX: "false" })!.addToCart({})
    } finally {
      global.fetch = original
    }
    expect(fetchImpl.mock.calls[0][0]).toContain("sandbox.melhorenvio.com.br")
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer tok")
    expect(fetchImpl.mock.calls[1][0]).toBe("https://melhorenvio.com.br/api/v2/me/cart")
  })
})
