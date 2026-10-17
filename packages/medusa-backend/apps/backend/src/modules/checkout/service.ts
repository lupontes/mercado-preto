import { Context } from "@medusajs/framework/types"
import { InjectManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"
import CheckoutSnapshot from "./models/checkout-snapshot"

export type SnapshotStatus = "pending" | "paid" | "amount_mismatch"

type InitialSnapshotState = {
  status?: SnapshotStatus
  paymentId?: string
  ordersCreatedAt?: Date
}

class CheckoutModuleService extends MedusaService({ CheckoutSnapshot }) {
  async recordSnapshot(
    externalReference: string,
    payload: Record<string, unknown>,
    initial?: InitialSnapshotState
  ) {
    return this.createCheckoutSnapshots({ externalReference, payload, ...initial } as any)
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

  // The conditional WHERE of a single UPDATE is what guarantees a single winner
  // under concurrency; a read-then-write would let two callers both succeed.
  // Legacy rows have a null status and count as "pending".
  @InjectManager()
  async transitionFromPending(
    externalReference: string,
    to: "paid" | "amount_mismatch",
    paymentId: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<boolean> {
    const rows = await this.runUpdate(
      `update "checkout_snapshot" set "status" = ?, "paymentId" = ?, updated_at = now()
       where "externalReference" = ? and coalesce("status", 'pending') = 'pending' and deleted_at is null
       returning id`,
      [to, paymentId, externalReference],
      sharedContext
    )
    return rows.length === 1
  }

  @InjectManager()
  async claimOrderCreation(
    externalReference: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<boolean> {
    const rows = await this.runUpdate(
      `update "checkout_snapshot" set "ordersCreatedAt" = now()
       where "externalReference" = ? and "ordersCreatedAt" is null and deleted_at is null
       returning id`,
      [externalReference],
      sharedContext
    )
    return rows.length === 1
  }

  @InjectManager()
  async releaseOrderCreation(
    externalReference: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    await this.runUpdate(
      `update "checkout_snapshot" set "ordersCreatedAt" = null
       where "externalReference" = ? returning id`,
      [externalReference],
      sharedContext
    )
  }

  private async runUpdate(sql: string, params: unknown[], sharedContext: Context): Promise<unknown[]> {
    const manager = sharedContext.manager as any
    return (await manager.execute(sql, params)) as unknown[]
  }
}

export default CheckoutModuleService
