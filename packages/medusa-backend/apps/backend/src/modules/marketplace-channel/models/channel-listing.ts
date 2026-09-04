import { model } from "@medusajs/framework/utils"

const ChannelListing = model.define("channel_listing", {
  id: model.id().primaryKey(),
  productId: model.text(),
  sellerId: model.text(),
  channel: model.enum(["mercado_livre"]),
  externalItemId: model.text().nullable(),
  externalCategoryId: model.text().nullable(),
  saleFeePercent: model.number().nullable(),
  saleFeeFixed: model.number().nullable(),
  status: model.enum(["draft", "published", "paused", "error"]).default("draft"),
  lastError: model.text().nullable(),
})

export default ChannelListing
