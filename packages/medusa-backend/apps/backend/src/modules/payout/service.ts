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
}

export default PayoutModuleService
