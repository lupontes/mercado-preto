import {
  refreshAccessToken,
  getListingFee,
  createItem,
  setItemDescription,
  getOrder,
  getShipmentLabelUrl,
  verifyWebhookSignature,
  generatePkcePair,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
} from "../mercadolivre-client"
import { createHmac, createHash } from "node:crypto"

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

describe("mercadolivre-client", () => {
  beforeEach(() => {
    process.env.MERCADOLIVRE_CLIENT_ID = "client-123"
    process.env.MERCADOLIVRE_CLIENT_SECRET = "secret-456"
    global.fetch = jest.fn()
  })

  describe("refreshAccessToken", () => {
    it("posts to /oauth/token with grant_type=refresh_token and returns the new tokens", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 21600 })
      )

      const result = await refreshAccessToken("old-refresh")

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.mercadolibre.com/oauth/token",
        expect.objectContaining({ method: "POST" })
      )
      const body = (global.fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams
      expect(body.get("grant_type")).toBe("refresh_token")
      expect(body.get("refresh_token")).toBe("old-refresh")
      expect(body.get("client_id")).toBe("client-123")
      expect(result).toEqual({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 21600 })
    })

    it("throws when the refresh request fails", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}, false, 400))

      await expect(refreshAccessToken("bad-refresh")).rejects.toThrow("400")
    })
  })

  describe("getListingFee", () => {
    it("requests listing_prices with price and category_id, returns percentage and fixed fee", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ sale_fee_details: { percentage_fee: 12.5, fixed_fee: 5 } })
      )

      const result = await getListingFee("token-abc", 7900, "MLB1000")

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.mercadolibre.com/sites/MLB/listing_prices?price=7900&category_id=MLB1000",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-abc" }) })
      )
      expect(result).toEqual({ percentageFee: 12.5, fixedFee: 5 })
    })
  })

  describe("createItem", () => {
    it("posts to /items with shipping.mode me2 and returns the created item id", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: "MLB999888777" }))

      const result = await createItem("token-abc", {
        title: "Bolsa Africana 2 em 1",
        categoryId: "MLB1000",
        price: 182,
        availableQuantity: 1,
        pictures: [{ source: "https://example.com/foto.jpg" }],
        attributes: [{ id: "BRAND", value_name: "Genérica" }],
      })

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe("https://api.mercadolibre.com/items")
      const sentBody = JSON.parse(init.body)
      expect(sentBody.shipping).toEqual({ mode: "me2" })
      expect(sentBody.category_id).toBe("MLB1000")
      expect(result).toEqual({ id: "MLB999888777" })
    })

    it("throws with the response detail when creation fails", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ message: "categoria inválida" }, false, 400)
      )

      await expect(
        createItem("token-abc", {
          title: "X",
          categoryId: "bad",
          price: 10,
          availableQuantity: 1,
          pictures: [],
          attributes: [],
        })
      ).rejects.toThrow("400")
    })
  })

  describe("setItemDescription", () => {
    it("posts to /items/:id/description with plain_text", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}))

      await setItemDescription("token-abc", "MLB999888777", "Bolsa artesanal feita à mão.")

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe("https://api.mercadolibre.com/items/MLB999888777/description")
      expect(init.method).toBe("POST")
      expect(init.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer token-abc", "Content-Type": "application/json" })
      )
      expect(JSON.parse(init.body)).toEqual({ plain_text: "Bolsa artesanal feita à mão." })
    })

    it("throws with the response detail when the update fails", async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ message: "descrição inválida" }, false, 400)
      )

      await expect(
        setItemDescription("token-abc", "MLB999888777", "descrição ruim")
      ).rejects.toThrow("400")
    })
  })

  describe("getOrder", () => {
    it("fetches /orders/:id with the bearer token", async () => {
      const mlOrder = { id: 123, status: "paid", order_items: [] }
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(mlOrder))

      const result = await getOrder("token-abc", "123")

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.mercadolibre.com/orders/123",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-abc" }) })
      )
      expect(result).toEqual(mlOrder)
    })
  })

  describe("getShipmentLabelUrl", () => {
    it("builds the label URL with the shipment id and access token", () => {
      const url = getShipmentLabelUrl("token-abc", "shipment-1")
      expect(url).toBe(
        "https://api.mercadolibre.com/shipment_labels?shipment_ids=shipment-1&response_type=pdf&access_token=token-abc"
      )
    })
  })
})

describe("verifyWebhookSignature", () => {
  function sign(dataId: string, requestId: string, ts: string, secret: string) {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
    return createHmac("sha256", secret).update(manifest).digest("hex")
  }

  it("returns true when the signature matches", () => {
    const secret = "webhook-secret"
    const ts = "1700000000"
    const hash = sign("555", "req-1", ts, secret)

    const result = verifyWebhookSignature({
      xSignature: `ts=${ts},v1=${hash}`,
      xRequestId: "req-1",
      dataId: "555",
      secret,
    })

    expect(result).toBe(true)
  })

  it("returns false when the signature doesn't match", () => {
    const secret = "webhook-secret"
    const ts = "1700000000"
    const hash = sign("555", "req-1", ts, "wrong-secret")

    const result = verifyWebhookSignature({
      xSignature: `ts=${ts},v1=${hash}`,
      xRequestId: "req-1",
      dataId: "555",
      secret,
    })

    expect(result).toBe(false)
  })

  it("returns false when the header is malformed", () => {
    const result = verifyWebhookSignature({
      xSignature: "not-a-valid-header",
      xRequestId: "req-1",
      dataId: "555",
      secret: "webhook-secret",
    })

    expect(result).toBe(false)
  })
})

describe("generatePkcePair", () => {
  it("returns a code_verifier and a matching S256 code_challenge", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair()

    expect(typeof codeVerifier).toBe("string")
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
    const expectedChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
    expect(codeChallenge).toBe(expectedChallenge)
  })

  it("returns a different pair on every call", () => {
    const first = generatePkcePair()
    const second = generatePkcePair()

    expect(first.codeVerifier).not.toBe(second.codeVerifier)
  })
})

describe("buildAuthorizationUrl", () => {
  it("builds the Mercado Livre authorization URL with PKCE and state", () => {
    const url = buildAuthorizationUrl({
      redirectUri: "https://example.com/admin/marketplace-channel/callback",
      state: "state-abc",
      codeChallenge: "challenge-xyz",
    })

    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe("https://auth.mercadolivre.com.br/authorization")
    expect(parsed.searchParams.get("response_type")).toBe("code")
    expect(parsed.searchParams.get("client_id")).toBe("client-123")
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/admin/marketplace-channel/callback")
    expect(parsed.searchParams.get("state")).toBe("state-abc")
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-xyz")
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
  })
})

describe("exchangeAuthorizationCode", () => {
  it("posts to /oauth/token with grant_type=authorization_code and returns the new tokens", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ access_token: "first-access", refresh_token: "first-refresh", expires_in: 21600 })
    )

    const result = await exchangeAuthorizationCode({
      code: "auth-code-1",
      redirectUri: "https://example.com/admin/marketplace-channel/callback",
      codeVerifier: "verifier-1",
    })

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/oauth/token",
      expect.objectContaining({ method: "POST" })
    )
    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("client_id")).toBe("client-123")
    expect(body.get("client_secret")).toBe("secret-456")
    expect(body.get("code")).toBe("auth-code-1")
    expect(body.get("redirect_uri")).toBe("https://example.com/admin/marketplace-channel/callback")
    expect(body.get("code_verifier")).toBe("verifier-1")
    expect(result).toEqual({ accessToken: "first-access", refreshToken: "first-refresh", expiresIn: 21600 })
  })

  it("throws when the code exchange fails", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}, false, 400))

    await expect(
      exchangeAuthorizationCode({ code: "bad-code", redirectUri: "https://example.com/callback", codeVerifier: "v" })
    ).rejects.toThrow("400")
  })
})
