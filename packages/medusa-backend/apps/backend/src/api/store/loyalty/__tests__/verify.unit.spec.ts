import { POST } from "../verify/route"
import { verifyLoyaltyToken } from "../../../../utils/loyalty-token"

let loyalty: { verifyCode: jest.Mock; availableBalance: jest.Mock }

function makeReq(body: unknown) {
  return { body, scope: { resolve: () => loyalty } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /store/loyalty/verify", () => {
  const original = process.env.JWT_SECRET
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret"
    loyalty = { verifyCode: jest.fn().mockResolvedValue(false), availableBalance: jest.fn().mockResolvedValue(250) }
  })
  afterAll(() => { process.env.JWT_SECRET = original })

  it("returns a token for the normalized document and the balance", async () => {
    loyalty.verifyCode.mockResolvedValue(true)
    const res = makeRes()
    await POST(makeReq({ document: "529.982.247-25", code: "482913" }), res)

    expect(loyalty.verifyCode).toHaveBeenCalledWith("52998224725", "482913")
    expect((res._body as any).balance).toBe(250)
    expect(verifyLoyaltyToken((res._body as any).token)).toEqual({ document: "52998224725" })
  })

  it("rejects a wrong code", async () => {
    const res = makeRes()
    await POST(makeReq({ document: "529.982.247-25", code: "000000" }), res)

    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Código inválido ou expirado." })
    expect(loyalty.availableBalance).not.toHaveBeenCalled()
  })

  it.each([[{ document: "529.982.247-25", code: "12" }], [{ document: "1", code: "123456" }]])("rejects malformed input %#", async (body) => {
    const res = makeRes()
    await POST(makeReq(body), res)
    expect(res._status).toBe(400)
  })
})
