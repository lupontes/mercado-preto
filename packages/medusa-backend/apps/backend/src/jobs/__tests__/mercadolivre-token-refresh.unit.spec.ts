jest.mock("../../utils/mercadolivre-client", () => ({
  refreshAccessToken: jest.fn(),
}))

import { refreshAccessToken } from "../../utils/mercadolivre-client"
import mercadolivreTokenRefresh from "../mercadolivre-token-refresh"
import { MARKETPLACE_CHANNEL_MODULE } from "../../modules/marketplace-channel"

function makeContainer(channelService: unknown, logger: unknown = { info: jest.fn(), error: jest.fn() }) {
  return {
    resolve: (key: string) => {
      if (key === MARKETPLACE_CHANNEL_MODULE) return channelService
      if (key === "logger") return logger
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
}

describe("mercadolivreTokenRefresh", () => {
  beforeEach(() => jest.clearAllMocks())

  it("does nothing when there is no credential yet", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue(null), saveCredential: jest.fn() }
    const container = makeContainer(channelService)

    await mercadolivreTokenRefresh(container as any)

    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it("does nothing when the token still has more than 30 minutes of validity", async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000) // 1h à frente
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ refreshToken: "r1", expiresAt: farFuture }),
      saveCredential: jest.fn(),
    }
    const container = makeContainer(channelService)

    await mercadolivreTokenRefresh(container as any)

    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it("refreshes and saves the new token when it's within 30 minutes of expiring", async () => {
    const soon = new Date(Date.now() + 10 * 60 * 1000) // 10min à frente
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ refreshToken: "old-refresh", expiresAt: soon }),
      saveCredential: jest.fn(),
    }
    ;(refreshAccessToken as jest.Mock).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 21600,
    })
    const container = makeContainer(channelService)

    await mercadolivreTokenRefresh(container as any)

    expect(refreshAccessToken).toHaveBeenCalledWith("old-refresh")
    expect(channelService.saveCredential).toHaveBeenCalledWith(
      "mercado_livre",
      "new-access",
      "new-refresh",
      expect.any(Date)
    )
  })

  it("logs an error and does not throw when the refresh call fails", async () => {
    const soon = new Date(Date.now() + 10 * 60 * 1000)
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ refreshToken: "old-refresh", expiresAt: soon }),
      saveCredential: jest.fn(),
    }
    const logger = { info: jest.fn(), error: jest.fn() }
    ;(refreshAccessToken as jest.Mock).mockRejectedValue(new Error("network error"))
    const container = makeContainer(channelService, logger)

    await expect(mercadolivreTokenRefresh(container as any)).resolves.not.toThrow()

    expect(logger.error).toHaveBeenCalled()
    expect(channelService.saveCredential).not.toHaveBeenCalled()
  })
})
