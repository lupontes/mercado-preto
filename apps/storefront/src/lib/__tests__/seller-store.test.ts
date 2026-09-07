import { afterEach, describe, expect, it } from "vitest"
import { useSellerStore } from "../seller-store"

describe("useSellerStore", () => {
  afterEach(() => {
    useSellerStore.setState({ seller: null })
  })

  it("starts with no seller", () => {
    expect(useSellerStore.getState().seller).toBeNull()
  })

  it("setSeller populates the seller profile", () => {
    const seller = { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" }
    useSellerStore.getState().setSeller(seller)
    expect(useSellerStore.getState().seller).toEqual(seller)
  })

  it("updateSeller merges partial changes into the existing profile", () => {
    useSellerStore.getState().setSeller({ id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" })
    useSellerStore.getState().updateSeller({ bio: "Nova bio" })
    expect(useSellerStore.getState().seller).toEqual(
      expect.objectContaining({ id: "seller_1", bio: "Nova bio" })
    )
  })

  it("clearSeller resets the profile to null", () => {
    useSellerStore.getState().setSeller({ id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" })
    useSellerStore.getState().clearSeller()
    expect(useSellerStore.getState().seller).toBeNull()
  })

  it("does not expose a token field", () => {
    expect(useSellerStore.getState()).not.toHaveProperty("token")
  })
})
