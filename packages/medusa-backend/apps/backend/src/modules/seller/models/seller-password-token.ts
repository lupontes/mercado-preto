import { model } from "@medusajs/framework/utils"

// One-time links to set or reset a seller's password. Only the SHA-256 of the
// token is stored, so a database read never yields a usable link.
const SellerPasswordToken = model.define("seller_password_token", {
  id: model.id().primaryKey(),
  sellerId: model.text(),
  tokenHash: model.text().unique(),
  expiresAt: model.dateTime(),
  usedAt: model.dateTime().nullable(),
})

export default SellerPasswordToken
