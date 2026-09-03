import { MedusaService } from "@medusajs/framework/utils"
import CheckoutSnapshot from "./models/checkout-snapshot"

class CheckoutModuleService extends MedusaService({ CheckoutSnapshot }) {
  async recordSnapshot(externalReference: string, payload: Record<string, unknown>) {
    return this.createCheckoutSnapshots({ externalReference, payload } as any)
  }

  async findByExternalReference(externalReference: string): Promise<any | null> {
    const [snapshot] = await this.listCheckoutSnapshots({ externalReference } as any)
    return snapshot ?? null
  }

  async attachPreferenceId(externalReference: string, preferenceId: string): Promise<void> {
    const snapshot = await this.findByExternalReference(externalReference)
    if (!snapshot) return
    await this.updateCheckoutSnapshots({ id: snapshot.id, preferenceId } as any)
  }
}

export default CheckoutModuleService
