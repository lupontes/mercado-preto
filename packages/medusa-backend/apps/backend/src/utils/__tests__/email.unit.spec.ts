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
})
