import crypto from "crypto"
import { Context } from "@medusajs/framework/types"
import { InjectManager, InjectTransactionManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"
import LoyaltyEntry from "./models/loyalty-entry"
import LoyaltyCode from "./models/loyalty-code"
import { CODE_MAX_ATTEMPTS, CODE_TTL_MINUTES, RESERVATION_TTL_MINUTES } from "./constants"

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex")

// Reservations older than the TTL no longer hold points: an unpaid checkout
// gives them back without any cleanup job.
const BALANCE_SQL = `
  select coalesce(sum(points), 0)::int as balance from "loyalty_entry"
  where "buyerDocument" = ? and deleted_at is null
    and (type <> 'reserve' or created_at > now() - make_interval(mins => ?))`

class LoyaltyModuleService extends MedusaService({ LoyaltyEntry, LoyaltyCode }) {
  @InjectManager()
  async availableBalance(document: string, @MedusaContext() sharedContext: Context = {}): Promise<number> {
    const rows = await (sharedContext.manager as any).execute(BALANCE_SQL, [document, RESERVATION_TTL_MINUTES])
    return Number(rows[0]?.balance ?? 0)
  }

  /** Credits a paid checkout. The unique (type, externalReference) index makes it idempotent. */
  @InjectManager()
  async earn(
    document: string,
    externalReference: string,
    points: number,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<boolean> {
    const rows = await (sharedContext.manager as any).execute(
      `insert into "loyalty_entry" (id, "buyerDocument", type, points, "externalReference")
       values (?, ?, 'earn', ?, ?)
       on conflict do nothing returning id`,
      [`loyent_${crypto.randomUUID()}`, document, points, externalReference]
    )
    return rows.length === 1
  }

  // The advisory lock serializes reservations of the same document, so two
  // checkouts cannot both see the same balance and overspend it.
  @InjectTransactionManager()
  async reserve(
    document: string,
    externalReference: string,
    points: number,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<boolean> {
    const manager = sharedContext.transactionManager as any
    await manager.execute(`select pg_advisory_xact_lock(hashtext(?))`, [`loyalty:${document}`])
    const [{ balance }] = await manager.execute(BALANCE_SQL, [document, RESERVATION_TTL_MINUTES])
    if (points <= 0 || points > Number(balance)) return false
    await manager.execute(
      `insert into "loyalty_entry" (id, "buyerDocument", type, points, "externalReference")
       values (?, ?, 'reserve', ?, ?)`,
      [`loyent_${crypto.randomUUID()}`, document, -points, externalReference]
    )
    return true
  }

  @InjectManager()
  async cancelReservation(externalReference: string, @MedusaContext() sharedContext: Context = {}): Promise<void> {
    await (sharedContext.manager as any).execute(
      `update "loyalty_entry" set deleted_at = now()
       where "externalReference" = ? and type = 'reserve' and deleted_at is null`,
      [externalReference]
    )
  }

  /**
   * When a checkout's points stop being held, or null if it holds none. A
   * discounted checkout must not be paid after this, or the same points could
   * be spent again by another checkout.
   */
  @InjectManager()
  async reservationExpiresAt(externalReference: string, @MedusaContext() sharedContext: Context = {}): Promise<Date | null> {
    const rows = await (sharedContext.manager as any).execute(
      `select created_at + make_interval(mins => ?) as expires_at from "loyalty_entry"
       where "externalReference" = ? and type = 'reserve' and deleted_at is null
         and created_at > now() - make_interval(mins => ?)`,
      [RESERVATION_TTL_MINUTES, externalReference, RESERVATION_TTL_MINUTES]
    )
    return rows[0] ? new Date(rows[0].expires_at) : null
  }

  /** Turns a checkout's reservation into a redemption exactly once. */
  @InjectManager()
  async confirmRedemption(externalReference: string, @MedusaContext() sharedContext: Context = {}): Promise<boolean> {
    const rows = await (sharedContext.manager as any).execute(
      `update "loyalty_entry" set type = 'redeem', updated_at = now()
       where "externalReference" = ? and type = 'reserve' and deleted_at is null
       returning id`,
      [externalReference]
    )
    return rows.length === 1
  }

  /** Issues a 6-digit code, invalidating the document's earlier ones. Returns the raw code. */
  @InjectManager()
  async issueCode(document: string, @MedusaContext() sharedContext: Context = {}): Promise<string> {
    const manager = sharedContext.manager as any
    await manager.execute(
      `update "loyalty_code" set "usedAt" = now() where "buyerDocument" = ? and "usedAt" is null`,
      [document]
    )
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
    await manager.execute(
      `insert into "loyalty_code" (id, "buyerDocument", "codeHash", "expiresAt", attempts)
       values (?, ?, ?, now() + make_interval(mins => ?), 0)`,
      [`loycode_${crypto.randomUUID()}`, document, sha256(code), CODE_TTL_MINUTES]
    )
    return code
  }

  // Every try counts against the live code, so guessing stops after
  // CODE_MAX_ATTEMPTS even if the right code comes later.
  @InjectManager()
  async verifyCode(document: string, code: string, @MedusaContext() sharedContext: Context = {}): Promise<boolean> {
    const manager = sharedContext.manager as any
    const [live] = await manager.execute(
      `update "loyalty_code" set attempts = attempts + 1
       where id = (
         select id from "loyalty_code"
         where "buyerDocument" = ? and "usedAt" is null and "expiresAt" > now() and attempts < ?
         order by created_at desc limit 1
       )
       -- Re-checked on the locked row: under READ COMMITTED the subquery is not
       -- re-evaluated, so concurrent guesses would otherwise all get through.
       and "usedAt" is null and "expiresAt" > now() and attempts < ?
       returning id, "codeHash"`,
      [document, CODE_MAX_ATTEMPTS, CODE_MAX_ATTEMPTS]
    )
    if (!live || live.codeHash !== sha256(code)) return false
    const used = await manager.execute(
      `update "loyalty_code" set "usedAt" = now() where id = ? and "usedAt" is null returning id`,
      [live.id]
    )
    return used.length === 1
  }
}

export default LoyaltyModuleService
