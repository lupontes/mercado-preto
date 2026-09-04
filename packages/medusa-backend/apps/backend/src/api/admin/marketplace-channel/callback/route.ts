import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../../../../modules/marketplace-channel/service"
import { exchangeAuthorizationCode, buildCallbackRedirectUri } from "../../../../utils/mercadolivre-client"
import { timingSafeEqual } from "node:crypto"

const STATE_COOKIE = "ml_oauth_state"
const VERIFIER_COOKIE = "ml_oauth_verifier"

function readCookie(req: MedusaRequest, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=")
    if (separatorIndex === -1) continue
    const key = part.slice(0, separatorIndex).trim()
    if (key === name) return decodeURIComponent(part.slice(separatorIndex + 1).trim())
  }
  return undefined
}

// Mesmo padrão de comparação constant-time já usado em verifyWebhookSignature
// (mercadolivre-client.ts) — guarda de tamanho antes do timingSafeEqual, que
// lança exceção se os buffers tiverem tamanhos diferentes.
function statesMatch(received: string, expected: string): boolean {
  const receivedBuf = Buffer.from(received)
  const expectedBuf = Buffer.from(expected)
  if (receivedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(receivedBuf, expectedBuf)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")
  const { code, state } = req.query as { code?: string; state?: string }

  const expectedState = readCookie(req, STATE_COOKIE)
  const codeVerifier = readCookie(req, VERIFIER_COOKIE)

  res.clearCookie(STATE_COOKIE)
  res.clearCookie(VERIFIER_COOKIE)

  if (!code || !state || !expectedState || !codeVerifier || !statesMatch(state, expectedState)) {
    logger.error("[mercadolivre/oauth] callback inválido — state ausente/divergente ou code ausente")
    return res.status(400).json({ error: "Autorização inválida ou expirada. Tente conectar novamente." })
  }

  try {
    const channelService: MarketplaceChannelModuleService = req.scope.resolve(MARKETPLACE_CHANNEL_MODULE)
    const redirectUri = buildCallbackRedirectUri()
    const tokens = await exchangeAuthorizationCode({ code, redirectUri, codeVerifier })
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000)
    await channelService.saveCredential("mercado_livre", tokens.accessToken, tokens.refreshToken, expiresAt)

    res.json({ connected: true, channel: "mercado_livre" })
  } catch (err) {
    logger.error("[mercadolivre/oauth] falha ao trocar código por token:", err)
    res.status(502).json({ error: "Falha ao conectar com o Mercado Livre." })
  }
}
