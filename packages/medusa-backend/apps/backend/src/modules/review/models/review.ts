import { model } from "@medusajs/framework/utils"

const Review = model.define("review", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  productId: model.text(),
  sellerId: model.text(),
  rating: model.number(),
  comment: model.text().nullable(),
  reviewerName: model.text(),
  status: model.enum(["pending", "published", "rejected"]).default("pending"),
})

export default Review
