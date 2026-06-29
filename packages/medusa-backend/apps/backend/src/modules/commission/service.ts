import { MedusaService } from "@medusajs/framework/utils"
import Commission from "./models/commission"
import MarketplaceConfig from "./models/marketplace-config"

type CalculateInput = {
  orderId: string
  sellerId: string
  grossAmount: number
  bankingFees: number
  commissionRate?: number
}

class CommissionModuleService extends MedusaService({ Commission, MarketplaceConfig }) {
  async getCommissionRate(): Promise<number> {
    try {
      const configs = await this.listMarketplaceConfigs({ key: "commission_rate" })
      if (configs[0]) return Number(configs[0].value)
    } catch {}
    return Number(process.env.MARKETPLACE_COMMISSION_RATE ?? 15)
  }

  async setCommissionRate(rate: number): Promise<void> {
    const configs = await this.listMarketplaceConfigs({ key: "commission_rate" })
    if (configs[0]) {
      await this.updateMarketplaceConfigs({
        selector: { id: configs[0].id },
        data: { value: String(rate) },
      })
    } else {
      await this.createMarketplaceConfigs({ key: "commission_rate", value: String(rate) })
    }
  }

  calculate(input: CalculateInput) {
    const rate = input.commissionRate
      ?? Number(process.env.MARKETPLACE_COMMISSION_RATE ?? 15)

    const netAmount = input.grossAmount - input.bankingFees
    const commissionAmount = Math.round(netAmount * (rate / 100))
    const sellerPayout = netAmount - commissionAmount

    return {
      orderId: input.orderId,
      sellerId: input.sellerId,
      grossAmount: input.grossAmount,
      bankingFees: input.bankingFees,
      netAmount,
      commissionRate: rate,
      commissionAmount,
      sellerPayout,
    }
  }

  async recordAndCreate(input: CalculateInput) {
    const calculated = this.calculate(input)
    const commission = await this.createCommissions(calculated as any)
    return commission
  }

  async markAsPaid(id: string) {
    const [commission] = await this.updateCommissions({
      selector: { id },
      data: { status: "paid" as const, paidAt: new Date() },
    })
    return commission
  }
}

export default CommissionModuleService
