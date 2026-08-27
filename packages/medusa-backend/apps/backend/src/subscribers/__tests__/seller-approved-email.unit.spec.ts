import sellerApprovedEmail from "../seller-approved-email"

function makeContainer(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

const seller = {
  id: "seller_1",
  email: "loja-real@example.com",
  ownerName: "Fulana",
  name: "Loja Real",
}

describe("sellerApprovedEmail", () => {
  const original = { ...process.env }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
    process.env.BREVO_API_KEY = "brevo-key"
    process.env.MARKETPLACE_SANDBOX = "true"
    process.env.TEST_EMAIL_RECIPIENT = "tester@mercadopreto.com.br"
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("does nothing when BREVO_API_KEY is not configured", async () => {
    delete process.env.BREVO_API_KEY
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("redirects to TEST_EMAIL_RECIPIENT in sandbox mode instead of the seller's real email", async () => {
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.to).toEqual([{ email: "tester@mercadopreto.com.br" }])
  })

  it("does not send and logs an error when sandbox mode has no TEST_EMAIL_RECIPIENT configured", async () => {
    delete process.env.TEST_EMAIL_RECIPIENT
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("sends to the seller's real email when MARKETPLACE_SANDBOX=false", async () => {
    process.env.MARKETPLACE_SANDBOX = "false"
    const listSellers = jest.fn().mockResolvedValue([seller])

    await sellerApprovedEmail({
      event: { data: { id: "seller_1" } },
      container: makeContainer({ seller: { listSellers } }),
    } as any)

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.to).toEqual([{ email: "loja-real@example.com" }])
  })
})
