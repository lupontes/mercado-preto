import { model } from "@medusajs/framework/utils"

// One-time codes e-mailed to confirm who is using a document's points.
// Only the SHA-256 of the code is stored.
const LoyaltyCode = model.define("loyalty_code", {
  id: model.id().primaryKey(),
  buyerDocument: model.text().index(),
  codeHash: model.text(),
  expiresAt: model.dateTime(),
  attempts: model.number().default(0),
  usedAt: model.dateTime().nullable(),
})

export default LoyaltyCode
