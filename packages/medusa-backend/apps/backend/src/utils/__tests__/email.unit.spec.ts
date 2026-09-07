import { sendBrevoEmail } from "../email"

describe("sendBrevoEmail", () => {
  const originalApiKey = process.env.BREVO_API_KEY
  const originalSandbox = process.env.MARKETPLACE_SANDBOX

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.BREVO_API_KEY
    else process.env.BREVO_API_KEY = originalApiKey
    if (originalSandbox === undefined) delete process.env.MARKETPLACE_SANDBOX
    else process.env.MARKETPLACE_SANDBOX = originalSandbox
    jest.restoreAllMocks()
  })

  it("does nothing when BREVO_API_KEY is not set", async () => {
    delete process.env.BREVO_API_KEY
    const fetchSpy = jest.spyOn(global, "fetch")

    await sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("posts to the Brevo API when the key is set and sandbox is off", async () => {
    process.env.BREVO_API_KEY = "test-key"
    process.env.MARKETPLACE_SANDBOX = "false"
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response)

    await sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("does nothing in sandbox mode without a TEST_EMAIL_RECIPIENT", async () => {
    process.env.BREVO_API_KEY = "test-key"
    delete process.env.MARKETPLACE_SANDBOX // default is sandbox on
    delete process.env.TEST_EMAIL_RECIPIENT
    const fetchSpy = jest.spyOn(global, "fetch")

    await sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("logs but does not throw when the Brevo API call rejects (network failure)", async () => {
    process.env.BREVO_API_KEY = "test-key"
    process.env.MARKETPLACE_SANDBOX = "false"
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("network down"))
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    await expect(sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith("[email] falha ao chamar a API da Brevo:", expect.any(Error))
  })

  it("logs when Brevo responds with a non-2xx status", async () => {
    process.env.BREVO_API_KEY = "test-key"
    process.env.MARKETPLACE_SANDBOX = "false"
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 400 } as Response)
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    await sendBrevoEmail("cliente@teste.com", "Assunto", "<p>Corpo</p>")

    expect(errorSpy).toHaveBeenCalledWith("[email] Brevo respondeu 400 ao enviar para cliente@teste.com")
  })
})
