import { MedusaService } from "@medusajs/framework/utils"
import Commission from "./models/commission"

type CalculateInput = {
  orderId: string
  sellerId: string
  grossAmount: number
  bankingFees: number
  commissionRate?: number
}

class CommissionModuleService extends MedusaService({ Commission }) {
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
    const [commission] = await this.createCommissions(calculated)
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
