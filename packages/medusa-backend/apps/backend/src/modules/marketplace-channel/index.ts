import { Module } from "@medusajs/framework/utils"
import MarketplaceChannelModuleService from "./service"

export const MARKETPLACE_CHANNEL_MODULE = "marketplace_channel"

export default Module(MARKETPLACE_CHANNEL_MODULE, {
  service: MarketplaceChannelModuleService,
})
