import { MedusaService } from "@medusajs/framework/utils"
import ChannelListing from "./models/channel-listing"
import ChannelCredential from "./models/channel-credential"

type RecordListingInput = {
  productId: string
  sellerId: string
  channel: string
  externalItemId: string
  externalCategoryId: string
  saleFeePercent: number
  saleFeeFixed: number
}

class MarketplaceChannelModuleService extends MedusaService({ ChannelListing, ChannelCredential }) {
  async recordListing(input: RecordListingInput) {
    return this.createChannelListings({ ...input, status: "published" } as any)
  }

  async recordListingError(productId: string, sellerId: string, channel: string, errorMessage: string) {
    return this.createChannelListings({ productId, sellerId, channel, status: "error", lastError: errorMessage } as any)
  }

  async findListingByExternalItemId(externalItemId: string): Promise<any | null> {
    const [listing] = await this.listChannelListings({ externalItemId } as any)
    return listing ?? null
  }

  async getCredential(channel: string): Promise<any | null> {
    const [credential] = await this.listChannelCredentials({ channel } as any)
    return credential ?? null
  }

  async saveCredential(channel: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
    const existing = await this.getCredential(channel)
    if (existing) {
      await this.updateChannelCredentials({ id: existing.id, accessToken, refreshToken, expiresAt } as any)
    } else {
      await this.createChannelCredentials({ channel, accessToken, refreshToken, expiresAt } as any)
    }
  }
}

export default MarketplaceChannelModuleService
