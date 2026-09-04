import { MedusaContainer } from "@medusajs/framework/types"
import { MARKETPLACE_CHANNEL_MODULE } from "../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../modules/marketplace-channel/service"
import { refreshAccessToken } from "../utils/mercadolivre-client"

const REFRESH_MARGIN_MS = 30 * 60 * 1000 // renova com 30min de folga antes de expirar

export default async function mercadolivreTokenRefresh({ container }: { container: MedusaContainer }) {
  const channelService: MarketplaceChannelModuleService = container.resolve(MARKETPLACE_CHANNEL_MODULE)
  const logger = container.resolve("logger") as { info: (msg: string) => void; error: (msg: string) => void }

  const credential = await channelService.getCredential("mercado_livre")
  if (!credential) {
    logger.info("[mercadolivre-token-refresh] nenhuma credencial cadastrada, nada a fazer")
    return
  }

  const expiresAt = new Date(credential.expiresAt)
  if (expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    logger.info("[mercadolivre-token-refresh] token ainda válido, nada a fazer")
    return
  }

  try {
    const refreshed = await refreshAccessToken(credential.refreshToken)
    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000)
    await channelService.saveCredential("mercado_livre", refreshed.accessToken, refreshed.refreshToken, newExpiresAt)
    logger.info("[mercadolivre-token-refresh] token renovado com sucesso")
  } catch (err) {
    logger.error(`[mercadolivre-token-refresh] falha ao renovar token: ${err}`)
  }
}
