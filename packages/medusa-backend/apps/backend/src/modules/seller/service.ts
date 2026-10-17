import crypto from "crypto"
import { Context } from "@medusajs/framework/types"
import { InjectManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"
import Seller from "./models/seller"
import SellerPasswordToken from "./models/seller-password-token"

// The approval e-mail may sit unread for days; a reset link is requested on
// the spot, so it can be short-lived.
export const SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto.scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const computed = crypto.scryptSync(password, salt, 64).toString("hex")
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(computed, "hex"))
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

class SellerModuleService extends MedusaService({ Seller, SellerPasswordToken }) {
  static hashPassword = hashPassword
  static verifyPassword = verifyPassword
  static hashToken = hashToken

  /** Issues a one-time token and invalidates the seller's earlier unused ones. */
  @InjectManager()
  async issuePasswordToken(
    sellerId: string,
    ttlMs: number,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<string> {
    const manager = sharedContext.manager as any
    await manager.execute(
      `update "seller_password_token" set "usedAt" = now(), updated_at = now()
       where "sellerId" = ? and "usedAt" is null and deleted_at is null`,
      [sellerId]
    )
    const raw = crypto.randomBytes(32).toString("hex")
    await this.createSellerPasswordTokens(
      { sellerId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) },
      sharedContext
    )
    return raw
  }

  // A single conditional UPDATE is what makes the token single-use under
  // concurrency; a read-then-write would let two submissions both succeed.
  @InjectManager()
  async consumePasswordToken(
    rawToken: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<string | null> {
    const manager = sharedContext.manager as any
    const rows = (await manager.execute(
      `update "seller_password_token" set "usedAt" = now(), updated_at = now()
       where "tokenHash" = ? and "usedAt" is null and "expiresAt" > now() and deleted_at is null
       returning "sellerId"`,
      [hashToken(rawToken)]
    )) as Array<{ sellerId: string }>
    return rows[0]?.sellerId ?? null
  }
  async approveSeller(id: string): Promise<any> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "approved" as const, rejectionReason: null },
    })
    return seller
  }

  async suspendSeller(id: string, reason?: string): Promise<any> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "suspended" as const, rejectionReason: reason ?? null },
    })
    return seller
  }

  async rejectSeller(id: string, reason: string): Promise<any> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "pending" as const, rejectionReason: reason },
    })
    return seller
  }

  async activateSeller(id: string): Promise<any> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "active" as const, rejectionReason: null },
    })
    return seller
  }
}

export default SellerModuleService
