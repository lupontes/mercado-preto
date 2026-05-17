import { model } from "@medusajs/framework/utils"

const MarketplaceConfig = model.define("marketplace_config", {
  id: model.id().primaryKey(),
  key: model.text(),
  value: model.text(),
})

export default MarketplaceConfig
