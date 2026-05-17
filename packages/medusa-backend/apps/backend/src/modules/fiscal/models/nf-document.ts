import { model } from "@medusajs/framework/utils"

const NfDocument = model.define("nf_document", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  sellerId: model.text(),
  type: model.enum(["nfe", "nfse"]).default("nfe"),
  status: model.enum(["pending", "processing", "issued", "cancelled", "error"]).default("pending"),
  focusNfeRef: model.text().nullable(),
  focusNfeId: model.text().nullable(),
  xmlUrl: model.text().nullable(),
  pdfUrl: model.text().nullable(),
  series: model.text().nullable(),
  number: model.text().nullable(),
  issuedAt: model.dateTime().nullable(),
  errorMessage: model.text().nullable(),
  amountCents: model.number(),
})

export default NfDocument
