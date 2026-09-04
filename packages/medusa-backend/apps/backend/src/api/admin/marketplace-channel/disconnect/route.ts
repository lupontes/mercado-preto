import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../../../../modules/marketplace-channel/service"

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const channelService: MarketplaceChannelModuleService = req.scope.resolve(MARKETPLACE_CHANNEL_MODULE)
  await channelService.deleteCredential("mercado_livre")
  res.json({ disconnected: true, channel: "mercado_livre" })
}
