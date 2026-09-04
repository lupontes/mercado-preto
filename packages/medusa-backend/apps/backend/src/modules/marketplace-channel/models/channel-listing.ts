import { model } from "@medusajs/framework/utils"

const ChannelListing = model.define("channel_listing", {
  id: model.id().primaryKey(),
  productId: model.text(),
  sellerId: model.text(),
  channel: model.enum(["mercado_livre"]),
  externalItemId: model.text().nullable(),
  externalCategoryId: model.text().nullable(),
  saleFeePercent: model.float().nullable(),
  // Armazenado em centavos, mesma convenção de unidade monetária usada em todo
  // o restante da base (order.total, product prices, valores MercadoPago) —
  // a API do Mercado Livre retorna esse valor em reais, então a conversão
  // (* 100) acontece no momento da escrita, em publish/route.ts.
  saleFeeFixed: model.float().nullable(),
  status: model.enum(["draft", "published", "paused", "error"]).default("draft"),
  lastError: model.text().nullable(),
})

export default ChannelListing
