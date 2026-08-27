import { isSandboxMode } from "./sandbox"

const REQUIRED_ENV_VARS = ["JWT_SECRET", "COOKIE_SECRET", "DATABASE_URL", "CLEARSALE_WEBHOOK_SECRET"] as const

export function validateEnv(): void {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}. Set it in your .env file.`)
    }
  }

  const sandbox = isSandboxMode()

  const mercadopagoToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (mercadopagoToken) {
    const looksLikeTestToken = mercadopagoToken.startsWith("TEST-")
    if (sandbox && !looksLikeTestToken) {
      throw new Error(
        "MERCADOPAGO_ACCESS_TOKEN looks like a production token (doesn't start with 'TEST-') but MARKETPLACE_SANDBOX is not 'false'. Use a sandbox token or set MARKETPLACE_SANDBOX=false."
      )
    }
    if (!sandbox && looksLikeTestToken) {
      throw new Error(
        "MERCADOPAGO_ACCESS_TOKEN is a sandbox token (starts with 'TEST-') but MARKETPLACE_SANDBOX=false. Use a production token."
      )
    }
  }

  const focusNfeToken = process.env.FOCUS_NFE_TOKEN
  if (focusNfeToken) {
    const focusNfeSandbox = process.env.FOCUS_NFE_SANDBOX === "true"
    if (sandbox && !focusNfeSandbox) {
      throw new Error(
        "FOCUS_NFE_SANDBOX must be 'true' when MARKETPLACE_SANDBOX is not 'false' (sandbox mode). Set FOCUS_NFE_SANDBOX=true."
      )
    }
    if (!sandbox && focusNfeSandbox) {
      throw new Error(
        "FOCUS_NFE_SANDBOX is 'true' but MARKETPLACE_SANDBOX=false (production mode). Set FOCUS_NFE_SANDBOX=false."
      )
    }
  }
}
