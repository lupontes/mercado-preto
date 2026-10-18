import { model } from "@medusajs/framework/utils"

// The balance is never stored: it is always the sum of these entries.
// earn = points from a paid purchase, reserve = points held by an unpaid
// checkout (negative), redeem = a reservation whose checkout was paid.
const LoyaltyEntry = model
  .define("loyalty_entry", {
    id: model.id().primaryKey(),
    buyerDocument: model.text().index(),
    type: model.enum(["earn", "reserve", "redeem"]),
    points: model.number(),
    externalReference: model.text().nullable(),
  })
  .indexes([{ on: ["type", "externalReference"], unique: true, where: "deleted_at IS NULL" }])

export default LoyaltyEntry
