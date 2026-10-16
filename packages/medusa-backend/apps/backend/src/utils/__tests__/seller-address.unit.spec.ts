import { hasShippingOrigin, normalizePostalCode, sellerAddressSchema } from "../seller-address"

const valid = {
  addressPostalCode: "44300-000",
  addressStreet: "Rua Sete de Setembro",
  addressNumber: "12",
  addressDistrict: "Centro Histórico",
  addressCity: "Cachoeira",
  addressState: "ba",
}

describe("sellerAddressSchema", () => {
  it("normalizes CEP to digits and UF to upper case", () => {
    const parsed = sellerAddressSchema.parse(valid)
    expect(parsed.addressPostalCode).toBe("44300000")
    expect(parsed.addressState).toBe("BA")
    expect(parsed.addressComplement).toBeUndefined()
  })

  it("rejects an invalid CEP, an unknown UF and blank required fields", () => {
    expect(sellerAddressSchema.safeParse({ ...valid, addressPostalCode: "4430" }).success).toBe(false)
    expect(sellerAddressSchema.safeParse({ ...valid, addressState: "XX" }).success).toBe(false)
    expect(sellerAddressSchema.safeParse({ ...valid, addressNumber: "  " }).success).toBe(false)
  })
})

describe("hasShippingOrigin", () => {
  it("requires CEP, street, number, district, city and UF", () => {
    expect(hasShippingOrigin({ ...valid, addressPostalCode: "44300000" })).toBe(true)
    expect(hasShippingOrigin({ ...valid, addressNumber: null as any })).toBe(false)
    expect(hasShippingOrigin({ ...valid, addressPostalCode: "123" })).toBe(false)
    expect(hasShippingOrigin(null)).toBe(false)
  })
})

describe("normalizePostalCode", () => {
  it("keeps only digits", () => {
    expect(normalizePostalCode(" 44.300-000 ")).toBe("44300000")
  })
})
