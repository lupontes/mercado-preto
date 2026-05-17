import Medusa from "@medusajs/js-sdk"

export const medusa = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://localhost:9000",
  publishableKey: process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? "",
})
