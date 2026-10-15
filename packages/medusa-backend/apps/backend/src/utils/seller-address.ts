import { z } from "zod"

// Kept free of framework imports: the admin bundle imports this file too.

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const

export function normalizePostalCode(v: string): string {
  return v.replace(/\D/g, "")
}

const required = (label: string) => z.string().trim().min(1, `${label} obrigatório`)

/** Address of the store's operational base — the origin of every shipment. */
export const sellerAddressSchema = z.object({
  addressPostalCode: z
    .string()
    .transform(normalizePostalCode)
    .refine((v) => v.length === 8, "CEP deve ter 8 dígitos"),
  addressStreet: required("Rua"),
  addressNumber: required("Número"),
  addressComplement: z.string().trim().optional(),
  addressDistrict: required("Bairro"),
  addressCity: required("Cidade"),
  addressState: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => (UFS as readonly string[]).includes(v), "UF inválida"),
})

export type SellerAddress = z.infer<typeof sellerAddressSchema>

export function hasShippingOrigin(seller: Partial<Record<keyof SellerAddress, string | null>> | null | undefined): boolean {
  if (!seller) return false
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0
  return (
    normalizePostalCode(seller.addressPostalCode ?? "").length === 8 &&
    filled(seller.addressStreet) &&
    filled(seller.addressNumber) &&
    filled(seller.addressDistrict) &&
    filled(seller.addressCity) &&
    filled(seller.addressState)
  )
}
