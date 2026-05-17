import { model } from "@medusajs/framework/utils"

const Payout = model.define("payout", {
  id: model.id().primaryKey(),
  sellerId: model.text(),
  amount: model.bigNumber(),
  periodStart: model.dateTime(),
  periodEnd: model.dateTime(),
  status: model.enum(["pending", "processing", "completed", "failed"]).default("pending"),
  processedAt: model.dateTime().nullable(),
  notes: model.text().nullable(),
})

export default Payout
