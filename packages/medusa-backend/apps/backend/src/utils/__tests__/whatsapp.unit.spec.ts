import { sendWhatsApp } from "../whatsapp"

function setBaseEnv(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    EVOLUTION_API_URL: "https://evolution.example.com",
    EVOLUTION_API_KEY: "evo-key",
    EVOLUTION_API_INSTANCE: "mercadopreto",
    MARKETPLACE_SANDBOX: "true",
    TEST_WHATSAPP_RECIPIENT: "5511999999999",
  }
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe("sendWhatsApp", () => {
  const original = { ...process.env }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("does nothing when Evolution API is not configured", async () => {
    setBaseEnv({ EVOLUTION_API_URL: undefined })
    await sendWhatsApp("5571988887777", "hi")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("redirects to TEST_WHATSAPP_RECIPIENT in sandbox mode instead of the real number", async () => {
    setBaseEnv()
    await sendWhatsApp("5571988887777", "hi")

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.number).toBe("5511999999999")
    expect(body.number).not.toBe("5571988887777")
  })

  it("does not send and logs an error when sandbox mode has no TEST_WHATSAPP_RECIPIENT configured", async () => {
    setBaseEnv({ TEST_WHATSAPP_RECIPIENT: undefined })
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    await sendWhatsApp("5571988887777", "hi")

    expect(global.fetch).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("sends to the real phone number when MARKETPLACE_SANDBOX=false", async () => {
    setBaseEnv({ MARKETPLACE_SANDBOX: "false" })
    await sendWhatsApp("71988887777", "hi")

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.number).toBe("5571988887777")
  })
})
