jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        createChannelListings = jest.fn()
        listChannelListings = jest.fn()
        updateChannelListings = jest.fn()
        createChannelCredentials = jest.fn()
        listChannelCredentials = jest.fn()
        updateChannelCredentials = jest.fn()
        deleteChannelCredentials = jest.fn()
      },
  }
})

import MarketplaceChannelModuleService from "../service"

function makeService() {
  return new MarketplaceChannelModuleService() as any
}

describe("MarketplaceChannelModuleService", () => {
  describe("recordListing", () => {
    it("creates a channel_listing with status published", async () => {
      const svc = makeService()
      svc.createChannelListings.mockResolvedValue({ id: "cl_1" })

      await svc.recordListing({
        productId: "prod_1",
        sellerId: "seller_1",
        channel: "mercado_livre",
        externalItemId: "MLB123",
        externalCategoryId: "MLB1000",
        saleFeePercent: 12,
        saleFeeFixed: 5,
      })

      expect(svc.createChannelListings).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: "prod_1",
          sellerId: "seller_1",
          externalItemId: "MLB123",
          status: "published",
        })
      )
    })
  })

  describe("recordListingError", () => {
    it("creates a channel_listing with status error and the error message", async () => {
      const svc = makeService()
      svc.createChannelListings.mockResolvedValue({ id: "cl_1" })

      await svc.recordListingError("prod_1", "seller_1", "mercado_livre", "categoria inválida")

      expect(svc.createChannelListings).toHaveBeenCalledWith(
        expect.objectContaining({ productId: "prod_1", sellerId: "seller_1", status: "error", lastError: "categoria inválida" })
      )
    })
  })

  describe("findListingByExternalItemId", () => {
    it("returns the listing when found", async () => {
      const svc = makeService()
      svc.listChannelListings.mockResolvedValue([{ id: "cl_1", externalItemId: "MLB123" }])

      const result = await svc.findListingByExternalItemId("MLB123")

      expect(svc.listChannelListings).toHaveBeenCalledWith({ externalItemId: "MLB123" })
      expect(result).toEqual({ id: "cl_1", externalItemId: "MLB123" })
    })

    it("returns null when not found", async () => {
      const svc = makeService()
      svc.listChannelListings.mockResolvedValue([])

      const result = await svc.findListingByExternalItemId("MLB999")

      expect(result).toBeNull()
    })
  })

  describe("getCredential / saveCredential", () => {
    it("creates a new credential when none exists", async () => {
      const svc = makeService()
      svc.listChannelCredentials.mockResolvedValue([])
      const expiresAt = new Date("2026-09-04T12:00:00.000Z")

      await svc.saveCredential("mercado_livre", "token-abc", "refresh-xyz", expiresAt)

      expect(svc.createChannelCredentials).toHaveBeenCalledWith({
        channel: "mercado_livre",
        accessToken: "token-abc",
        refreshToken: "refresh-xyz",
        expiresAt,
      })
      expect(svc.updateChannelCredentials).not.toHaveBeenCalled()
    })

    it("updates the existing credential when one already exists", async () => {
      const svc = makeService()
      svc.listChannelCredentials.mockResolvedValue([{ id: "cc_1", channel: "mercado_livre" }])
      const expiresAt = new Date("2026-09-04T12:00:00.000Z")

      await svc.saveCredential("mercado_livre", "token-new", "refresh-new", expiresAt)

      expect(svc.updateChannelCredentials).toHaveBeenCalledWith({
        id: "cc_1",
        accessToken: "token-new",
        refreshToken: "refresh-new",
        expiresAt,
      })
      expect(svc.createChannelCredentials).not.toHaveBeenCalled()
    })
  })

  describe("deleteCredential", () => {
    it("deletes the existing credential for the channel", async () => {
      const svc = makeService()
      svc.listChannelCredentials.mockResolvedValue([{ id: "cc_1", channel: "mercado_livre" }])

      await svc.deleteCredential("mercado_livre")

      expect(svc.deleteChannelCredentials).toHaveBeenCalledWith("cc_1")
    })

    it("does nothing when there is no credential to delete", async () => {
      const svc = makeService()
      svc.listChannelCredentials.mockResolvedValue([])

      await svc.deleteCredential("mercado_livre")

      expect(svc.deleteChannelCredentials).not.toHaveBeenCalled()
    })
  })
})
