import { model } from "@medusajs/framework/utils"

const Seller = model.define("seller", {
  id: model.id().primaryKey(),
  name: model.text(),
  ownerName: model.text(),
  email: model.text(),
  phone: model.text(),
  cpfCnpj: model.text(),
  bio: model.text().nullable(),
  location: model.text().nullable(),
  category: model.text().nullable(),
  bankName: model.text().nullable(),
  bankAgency: model.text().nullable(),
  bankAccount: model.text().nullable(),
  bankAccountType: model.enum(["checking", "savings"]).nullable(),
  pixKey: model.text().nullable(),
  pixKeyType: model.enum(["cpf", "cnpj", "email", "phone", "random"]).nullable(),
  status: model.enum(["pending", "approved", "active", "suspended"]).default("pending"),
  rejectionReason: model.text().nullable(),
  mercadopagoUserId: model.text().nullable(),
})

export default Seller
