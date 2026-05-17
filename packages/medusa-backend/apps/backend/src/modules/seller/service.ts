import crypto from "crypto"
import { MedusaService } from "@medusajs/framework/utils"
import Seller from "./models/seller"

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

class SellerModuleService extends MedusaService({ Seller }) {
  static hashPassword = hashPassword
  static verifyPassword = verifyPassword
  async approveSeller(id: string): Promise<InstanceType<typeof Seller>> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "approved" as const, rejectionReason: null },
    })
    return seller
  }

  async suspendSeller(id: string, reason?: string): Promise<InstanceType<typeof Seller>> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "suspended" as const, rejectionReason: reason ?? null },
    })
    return seller
  }

  async rejectSeller(id: string, reason: string): Promise<InstanceType<typeof Seller>> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "pending" as const, rejectionReason: reason },
    })
    return seller
  }

  async activateSeller(id: string): Promise<InstanceType<typeof Seller>> {
    const [seller] = await this.updateSellers({
      selector: { id },
      data: { status: "active" as const },
    })
    return seller
  }
}

export default SellerModuleService
