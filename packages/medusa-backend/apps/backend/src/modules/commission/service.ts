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

  async calculate(input: CalculateInput) {
    const rate = input.commissionRate ?? await this.getCommissionRate()

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
    const calculated = await this.calculate(input)
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

  private async findUnlinkedPendingInPeriod(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date
  ) {
    const pending = await this.listCommissions({ sellerId, status: "pending", payoutId: null })
    return pending.filter((c: any) => {
      const created = new Date(c.created_at)
      return created >= periodStart && created <= periodEnd
    })
  }

  async linkPendingToPayout(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date,
    payoutId: string
  ): Promise<void> {
    const inPeriod = await this.findUnlinkedPendingInPeriod(sellerId, periodStart, periodEnd)
    for (const commission of inPeriod) {
      await this.updateCommissions({
        selector: { id: commission.id },
        data: { payoutId },
      })
    }
  }

  async sumUnlinkedPendingInPeriod(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{ amount: number; commissionCount: number }> {
    const inPeriod = await this.findUnlinkedPendingInPeriod(sellerId, periodStart, periodEnd)
    const amount = inPeriod.reduce((acc: number, c: any) => acc + Number(c.sellerPayout), 0)
    return { amount, commissionCount: inPeriod.length }
  }

  async markPaidByPayout(payoutId: string): Promise<void> {
    const linked = await this.listCommissions({ payoutId })
    for (const commission of linked) {
      await this.updateCommissions({
        selector: { id: commission.id },
        data: { status: "paid" as const, paidAt: new Date() },
      })
    }
  }

  async unlinkByPayout(payoutId: string): Promise<void> {
    const linked = await this.listCommissions({ payoutId })
    for (const commission of linked) {
      await this.updateCommissions({
        selector: { id: commission.id },
        data: { payoutId: null },
      })
    }
  }

  async linkSingleCommissionToPayout(commissionId: string, payoutId: string): Promise<void> {
    await this.updateCommissions({
      selector: { id: commissionId },
      data: { payoutId },
    })
  }
}

export default CommissionModuleService
