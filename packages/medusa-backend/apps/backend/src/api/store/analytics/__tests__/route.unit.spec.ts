import { POST } from "../route"

function makeReq(body: unknown, peer: string, xff?: string) {
  return {
    body,
    headers: { "user-agent": "jest", ...(xff ? { "x-forwarded-for": xff } : {}) },
    socket: { remoteAddress: peer },
  } as any
}

function makeRes() {
  const res = { _status: 200 } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = () => res
  res.end = () => res
  return res
}

const event = { name: "pageview", url: "https://teste.mercadopreto.com.br/" }

describe("POST /store/analytics", () => {
  const original = { ...process.env }
  let fetchMock: jest.Mock

  beforeEach(() => {
    process.env.PLAUSIBLE_URL = "https://plausible.example"
    process.env.PLAUSIBLE_DOMAIN = "mercadopreto.com.br"
    fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("does nothing without Plausible configured", async () => {
    delete process.env.PLAUSIBLE_URL
    const res = makeRes()
    await POST(makeReq(event, "8.8.8.8"), res)
    expect(res._status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ url: "https://x" }],
    [{ name: "x".repeat(501), url: "https://x" }],
    [{ name: "pageview", url: 42 }],
  ])("rejects an invalid event %#", async (body) => {
    const res = makeRes()
    await POST(makeReq(body, "8.8.8.8"), res)
    expect(res._status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("trusts the address nginx appended, not one the client sent", async () => {
    await POST(makeReq(event, "10.0.0.5", "1.1.1.1, 200.1.1.1"), makeRes())
    expect(fetchMock.mock.calls[0][1].headers["X-Forwarded-For"]).toBe("200.1.1.1")
  })

  it("ignores X-Forwarded-For from a direct client", async () => {
    await POST(makeReq(event, "8.8.8.8", "1.1.1.1"), makeRes())
    expect(fetchMock.mock.calls[0][1].headers["X-Forwarded-For"]).toBe("8.8.8.8")
  })

  it("still answers 202 when Plausible is down", async () => {
    fetchMock.mockRejectedValue(new Error("down"))
    const res = makeRes()
    await POST(makeReq(event, "8.8.8.8"), res)
    expect(res._status).toBe(202)
  })
})
