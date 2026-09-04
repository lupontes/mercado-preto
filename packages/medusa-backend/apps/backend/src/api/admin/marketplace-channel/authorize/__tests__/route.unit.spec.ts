jest.mock("../../../../../utils/mercadolivre-client", () => ({
  generatePkcePair: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
}))
jest.mock("node:crypto", () => ({
  ...jest.requireActual("node:crypto"),
  randomBytes: jest.fn(),
}))

import { randomBytes } from "node:crypto"
import { generatePkcePair, buildAuthorizationUrl } from "../../../../../utils/mercadolivre-client"
import { GET } from "../route"

function makeReq() {
  return {} as any
}

function makeRes() {
  const res = { _cookies: [] as Array<{ name: string; value: string; options: unknown }>, _redirectedTo: undefined as string | undefined } as any
  res.cookie = (name: string, value: string, options: unknown) => {
    res._cookies.push({ name, value, options })
    return res
  }
  res.redirect = (url: string) => {
    res._redirectedTo = url
    return res
  }
  return res
}

describe("GET /admin/marketplace-channel/authorize", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.BACKEND_URL = "https://example.com/api"
    ;(generatePkcePair as jest.Mock).mockReturnValue({ codeVerifier: "verifier-1", codeChallenge: "challenge-1" })
    ;(buildAuthorizationUrl as jest.Mock).mockReturnValue("https://auth.mercadolivre.com.br/authorization?mocked=1")
    ;(randomBytes as jest.Mock).mockReturnValue({ toString: () => "state-abc" })
  })

  it("sets httpOnly state and verifier cookies and redirects to the ML authorization URL", async () => {
    const res = makeRes()

    await GET(makeReq(), res)

    expect(buildAuthorizationUrl).toHaveBeenCalledWith({
      redirectUri: "https://example.com/api/admin/marketplace-channel/callback",
      state: "state-abc",
      codeChallenge: "challenge-1",
    })

    const stateCookie = res._cookies.find((c: any) => c.name === "ml_oauth_state")
    const verifierCookie = res._cookies.find((c: any) => c.name === "ml_oauth_verifier")
    expect(stateCookie).toEqual(
      expect.objectContaining({ value: "state-abc", options: expect.objectContaining({ httpOnly: true }) })
    )
    expect(verifierCookie).toEqual(
      expect.objectContaining({ value: "verifier-1", options: expect.objectContaining({ httpOnly: true }) })
    )

    expect(res._redirectedTo).toBe("https://auth.mercadolivre.com.br/authorization?mocked=1")
  })
})
