import { model } from "@medusajs/framework/utils"

const CheckoutSnapshot = model.define("checkout_snapshot", {
  id: model.id().primaryKey(),
  externalReference: model.text().unique(),
  payload: model.json(),
  preferenceId: model.text().nullable(),
  // null on legacy rows, which are treated as "pending"
  status: model.text().nullable(),
  paymentId: model.text().nullable(),
  ordersCreatedAt: model.dateTime().nullable(),
})

export default CheckoutSnapshot
