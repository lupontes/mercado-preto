import { randomBytes } from "node:crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { generatePkcePair, buildAuthorizationUrl, buildCallbackRedirectUri } from "../../../../utils/mercadolivre-client"

const STATE_COOKIE = "ml_oauth_state"
const VERIFIER_COOKIE = "ml_oauth_verifier"
const COOKIE_MAX_AGE_MS = 5 * 60 * 1000

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { codeVerifier, codeChallenge } = generatePkcePair()
  const state = randomBytes(16).toString("hex")
  const redirectUri = buildCallbackRedirectUri()

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: COOKIE_MAX_AGE_MS,
  }
  res.cookie(STATE_COOKIE, state, cookieOptions)
  res.cookie(VERIFIER_COOKIE, codeVerifier, cookieOptions)

  const url = buildAuthorizationUrl({ redirectUri, state, codeChallenge })
  res.redirect(url)
}
