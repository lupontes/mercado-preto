import { model } from "@medusajs/framework/utils"

const Commission = model.define("commission", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  sellerId: model.text(),
  grossAmount: model.bigNumber(),
  bankingFees: model.bigNumber(),
  netAmount: model.bigNumber(),
  commissionRate: model.number(),
  commissionAmount: model.bigNumber(),
  sellerPayout: model.bigNumber(),
  status: model.enum(["pending", "paid"]).default("pending"),
  paidAt: model.dateTime().nullable(),
  payoutId: model.text().nullable(),
})

export default Commission
