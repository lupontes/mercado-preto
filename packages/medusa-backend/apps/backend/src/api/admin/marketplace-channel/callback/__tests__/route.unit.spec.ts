jest.mock("../../../../../utils/mercadolivre-client", () => ({
  exchangeAuthorizationCode: jest.fn(),
  buildCallbackRedirectUri: jest.fn(),
}))

import { MARKETPLACE_CHANNEL_MODULE } from "../../../../../modules/marketplace-channel"
import { exchangeAuthorizationCode, buildCallbackRedirectUri } from "../../../../../utils/mercadolivre-client"
import { GET } from "../route"

function makeReq(overrides: Record<string, unknown> = {}) {
  const logger = { info: jest.fn(), error: jest.fn() }
  const channelService = { saveCredential: jest.fn().mockResolvedValue(undefined) }
  return {
    query: { code: "auth-code-1", state: "state-abc" },
    headers: { cookie: "ml_oauth_state=state-abc; ml_oauth_verifier=verifier-1" },
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === MARKETPLACE_CHANNEL_MODULE) return channelService
        return {}
      },
    },
    _logger: logger,
    _channelService: channelService,
    ...overrides,
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown, _clearedCookies: [] as string[] } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.clearCookie = (name: string) => { res._clearedCookies.push(name); return res }
  return res
}

describe("GET /admin/marketplace-channel/callback", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.BACKEND_URL = "https://example.com/api"
    ;(buildCallbackRedirectUri as jest.Mock).mockReturnValue("https://example.com/api/admin/marketplace-channel/callback")
  })

  it("exchanges the code, saves the credential, and clears the OAuth cookies", async () => {
    ;(exchangeAuthorizationCode as jest.Mock).mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 21600,
    })
    const req = makeReq()
    const res = makeRes()

    await GET(req, res)

    expect(exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: "auth-code-1",
      redirectUri: "https://example.com/api/admin/marketplace-channel/callback",
      codeVerifier: "verifier-1",
    })
    expect(req._channelService.saveCredential).toHaveBeenCalledWith(
      "mercado_livre",
      "access-1",
      "refresh-1",
      expect.any(Date)
    )
    expect(res._clearedCookies).toEqual(expect.arrayContaining(["ml_oauth_state", "ml_oauth_verifier"]))
    expect(res._body).toEqual({ connected: true, channel: "mercado_livre" })
  })

  it("returns 400 without exchanging anything when the state doesn't match the cookie", async () => {
    const req = makeReq({ query: { code: "auth-code-1", state: "wrong-state" } })
    const res = makeRes()

    await GET(req, res)

    expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(res._status).toBe(400)
  })

  it("returns 400 when only the verifier cookie is missing, even though the state matches", async () => {
    const req = makeReq({ headers: { cookie: "ml_oauth_state=state-abc" } })
    const res = makeRes()

    await GET(req, res)

    expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(res._status).toBe(400)
  })

  it("returns 400 when the state cookie is missing entirely", async () => {
    const req = makeReq({ headers: { cookie: "" } })
    const res = makeRes()

    await GET(req, res)

    expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(res._status).toBe(400)
  })

  it("returns 400 when the code query param is missing", async () => {
    const req = makeReq({ query: { state: "state-abc" } })
    const res = makeRes()

    await GET(req, res)

    expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(res._status).toBe(400)
  })

  it("returns 502 and does not save a credential when the code exchange fails", async () => {
    ;(exchangeAuthorizationCode as jest.Mock).mockRejectedValue(new Error("Mercado Livre troca de código OAuth falhou: 400"))
    const req = makeReq()
    const res = makeRes()

    await GET(req, res)

    expect(req._channelService.saveCredential).not.toHaveBeenCalled()
    expect(res._status).toBe(502)
  })
})
