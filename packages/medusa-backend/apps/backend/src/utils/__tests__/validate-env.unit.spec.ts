import { validateEnv } from "../validate-env"

function setBaseValidEnv() {
  process.env.JWT_SECRET = "jwt-secret"
  process.env.COOKIE_SECRET = "cookie-secret"
  process.env.DATABASE_URL = "postgres://localhost/test"
  process.env.CLEARSALE_WEBHOOK_SECRET = "clearsale-secret"
  delete process.env.MARKETPLACE_SANDBOX
  delete process.env.MERCADOPAGO_ACCESS_TOKEN
  delete process.env.FOCUS_NFE_TOKEN
  delete process.env.FOCUS_NFE_SANDBOX
}

describe("validateEnv", () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  describe("required env vars", () => {
    it.each(["JWT_SECRET", "COOKIE_SECRET", "DATABASE_URL", "CLEARSALE_WEBHOOK_SECRET"])(
      "throws when %s is missing",
      (key) => {
        setBaseValidEnv()
        delete process.env[key as string]
        expect(() => validateEnv()).toThrow(`Missing required environment variable: ${key}`)
      }
    )

    it("does not throw when all required vars are set and no optional integrations are configured", () => {
      setBaseValidEnv()
      expect(() => validateEnv()).not.toThrow()
    })
  })

  describe("MercadoPago sandbox consistency", () => {
    it("passes when sandbox mode (default) and token starts with TEST-", () => {
      setBaseValidEnv()
      process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-abc123"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when sandbox mode (default) and token looks like production", () => {
      setBaseValidEnv()
      process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-abc123"
      expect(() => validateEnv()).toThrow(/MERCADOPAGO_ACCESS_TOKEN/)
    })

    it("passes when MARKETPLACE_SANDBOX=false and token does not start with TEST-", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-abc123"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when MARKETPLACE_SANDBOX=false and token starts with TEST-", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-abc123"
      expect(() => validateEnv()).toThrow(/MERCADOPAGO_ACCESS_TOKEN/)
    })

    it("does not validate when MERCADOPAGO_ACCESS_TOKEN is unset", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      expect(() => validateEnv()).not.toThrow()
    })
  })

  describe("Focus NFe sandbox consistency", () => {
    it("passes when sandbox mode (default) and FOCUS_NFE_SANDBOX=true", () => {
      setBaseValidEnv()
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "true"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when sandbox mode (default) and FOCUS_NFE_SANDBOX=false", () => {
      setBaseValidEnv()
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "false"
      expect(() => validateEnv()).toThrow(/FOCUS_NFE_SANDBOX/)
    })

    it("passes when MARKETPLACE_SANDBOX=false and FOCUS_NFE_SANDBOX=false", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "false"
      expect(() => validateEnv()).not.toThrow()
    })

    it("throws when MARKETPLACE_SANDBOX=false and FOCUS_NFE_SANDBOX=true", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.FOCUS_NFE_TOKEN = "token123"
      process.env.FOCUS_NFE_SANDBOX = "true"
      expect(() => validateEnv()).toThrow(/FOCUS_NFE_SANDBOX/)
    })

    it("does not validate when FOCUS_NFE_TOKEN is unset", () => {
      setBaseValidEnv()
      process.env.MARKETPLACE_SANDBOX = "false"
      process.env.FOCUS_NFE_SANDBOX = "true"
      expect(() => validateEnv()).not.toThrow()
    })
  })
})
