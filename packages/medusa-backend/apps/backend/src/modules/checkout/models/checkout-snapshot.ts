import { model } from "@medusajs/framework/utils"

const CheckoutSnapshot = model.define("checkout_snapshot", {
  id: model.id().primaryKey(),
  externalReference: model.text().unique(),
  payload: model.json(),
  preferenceId: model.text().nullable(),
})

export default CheckoutSnapshot
