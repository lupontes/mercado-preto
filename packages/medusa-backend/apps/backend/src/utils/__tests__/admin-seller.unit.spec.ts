import { toAdminSeller } from "../admin-seller"

describe("toAdminSeller", () => {
  it("drops the password hash and keeps everything else", () => {
    const seller = { id: "seller_1", name: "Loja", email: "a@b.com", status: "active", passwordHash: "salt:hash" }
    expect(toAdminSeller(seller)).toEqual({ id: "seller_1", name: "Loja", email: "a@b.com", status: "active" })
  })
})
