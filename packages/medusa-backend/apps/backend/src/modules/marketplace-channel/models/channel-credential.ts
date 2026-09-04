import { model } from "@medusajs/framework/utils"

const ChannelCredential = model.define("channel_credential", {
  id: model.id().primaryKey(),
  channel: model.enum(["mercado_livre"]),
  accessToken: model.text(),
  refreshToken: model.text(),
  expiresAt: model.dateTime(),
})

export default ChannelCredential
