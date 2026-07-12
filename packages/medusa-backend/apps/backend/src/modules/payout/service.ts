import { MedusaService } from "@medusajs/framework/utils"
import Payout from "./models/payout"

class PayoutModuleService extends MedusaService({ Payout }) {
  async markAsProcessed(id: string): Promise<any> {
    const [payout] = await this.updatePayouts({
      selector: { id },
      data: { status: "completed" as const, processedAt: new Date() },
    })
    return payout
  }

  async cancelPayout(id: string): Promise<any> {
    const [payout] = await this.updatePayouts({
      selector: { id },
      data: { status: "cancelled" as const },
    })
    return payout
  }

  async incrementAmount(id: string, delta: number): Promise<any> {
    const [current] = await this.listPayouts({ id })
    const [payout] = await this.updatePayouts({
      selector: { id },
      data: { amount: Number(current.amount) + delta },
    })
    return payout
  }
}

export default PayoutModuleService
