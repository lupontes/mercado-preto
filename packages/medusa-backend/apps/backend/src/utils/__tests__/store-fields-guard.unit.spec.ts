import { readFileSync } from "fs"
import path from "path"
import { findForbiddenProductField, findForbiddenSellerField, PUBLIC_SELLER_FIELDS } from "../store-fields-guard"

const STOREFRONT_API = path.resolve(__dirname, "../../../../../../../apps/storefront/src/lib/api.ts")

describe("findForbiddenSellerField", () => {
  it("only exposes id, name and phone of the seller", () => {
    expect([...PUBLIC_SELLER_FIELDS].sort()).toEqual(["id", "name", "phone"])
  })

  it("accepts the field strings the storefront sends today", () => {
    // Copied from apps/storefront/src/lib/api.ts — if the storefront starts
    // asking for another seller field, this guard must be updated on purpose.
    expect(findForbiddenSellerField("*variants.prices,+seller.name,+seller.phone")).toBeNull()
    expect(findForbiddenSellerField("id,categories.id")).toBeNull()
    expect(findForbiddenSellerField("id,name,handle")).toBeNull()
  })

  it("accepts every fields= string found in the storefront API client", () => {
    const source = readFileSync(STOREFRONT_API, "utf8")
    const fieldStrings = [...source.matchAll(/fields=([^&$`"']+)/g)].map((m) => m[1])
    expect(fieldStrings.some((f) => f.includes("seller."))).toBe(true)
    for (const f of fieldStrings) expect(findForbiddenSellerField(f)).toBeNull()
  })

  it("ignores requests without fields", () => {
    expect(findForbiddenSellerField(undefined)).toBeNull()
    expect(findForbiddenSellerField("")).toBeNull()
  })

  it.each(["seller.id", "+seller.id", "seller.name", "+seller.phone", "-seller.name", " +seller.name "])(
    "accepts the public seller field %p",
    (token) => {
      expect(findForbiddenSellerField(`id,${token}`)).toBeNull()
    }
  )

  it.each([
    "+seller.cpfCnpj",
    "+seller.email",
    "+seller.addressState",
    "seller.passwordHash",
    "seller.pixKey",
    "-seller.email",
    "products.seller.email",
    "+items.product.seller.cpfCnpj",
    "+variants.product.seller.addressStreet",
  ])("rejects the private seller field %p", (token) => {
    expect(findForbiddenSellerField(`id,${token}`)).toBe(token)
  })

  it.each(["seller.*", "+seller.*", "*seller", "+*seller", "*product.seller", "products.seller.*", "seller", "+seller"])(
    "rejects the wildcard or whole-relation request %p",
    (token) => {
      expect(findForbiddenSellerField(`id,${token}`)).toBe(token)
    }
  )

  it.each(["Seller.email", "sellers.email", "seller_link.seller.email", "seller.products.seller.email", "seller.name.x"])(
    "rejects other seller-related paths %p",
    (token) => {
      expect(findForbiddenSellerField(token)).toBe(token)
    }
  )

  it("checks every value when fields is repeated in the query string", () => {
    expect(findForbiddenSellerField(["id", "+seller.name"])).toBeNull()
    expect(findForbiddenSellerField(["id", "+seller.email"])).toBe("+seller.email")
  })

  it("checks nested values when the query parser builds an object", () => {
    expect(findForbiddenSellerField({ a: "+seller.email" })).toBe("+seller.email")
  })

  it("does not flag unrelated fields", () => {
    expect(findForbiddenSellerField("id,title,*variants,+metadata,variants.prices.amount")).toBeNull()
  })
})

describe("findForbiddenProductField", () => {
  it.each(["metadata", "+metadata", "*metadata", "-metadata", "+*", "*", "metadata.pending"])(
    "rejects %p",
    (token) => {
      expect(findForbiddenProductField(`id,${token}`)).toBe(token)
    }
  )

  it.each(["title,+variants.prices", "*variants.prices,+seller.name", "variants.metadata", "metadatas", undefined, ""])(
    "accepts %p",
    (fields) => {
      expect(findForbiddenProductField(fields)).toBeNull()
    }
  )
})
