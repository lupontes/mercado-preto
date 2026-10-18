import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { LOYALTY_MODULE } from ".."
import LoyaltyModuleService from "../service"
import { RESERVATION_TTL_MINUTES } from "../constants"

jest.setTimeout(60000)

moduleIntegrationTestRunner<LoyaltyModuleService>({
  moduleName: LOYALTY_MODULE,
  resolve: "./src/modules/loyalty",
  testSuite: ({ service, MikroOrmWrapper }) => {
    const sql = (query: string, params: unknown[] = []) =>
      (MikroOrmWrapper.forkManager() as any).execute(query, params)

    describe("balance and reservations (real Postgres)", () => {
      it("credits a purchase once", async () => {
        expect(await service.earn("111", "r1", 100)).toBe(true)
        expect(await service.earn("111", "r1", 100)).toBe(false)
        expect(await service.availableBalance("111")).toBe(100)
      })

      it("reserves, cancels and confirms", async () => {
        await service.earn("222", "e1", 100)

        expect(await service.reserve("222", "c1", 30)).toBe(true)
        expect(await service.availableBalance("222")).toBe(70)
        expect(await service.reserve("222", "c2", 80)).toBe(false)

        await service.cancelReservation("c1")
        expect(await service.availableBalance("222")).toBe(100)

        expect(await service.reserve("222", "c3", 30)).toBe(true)
        expect(await service.confirmRedemption("c3")).toBe(true)
        expect(await service.confirmRedemption("c3")).toBe(false)
        expect(await service.availableBalance("222")).toBe(70)
      })

      it("gives expired reservations back, but never confirmed redemptions", async () => {
        await service.earn("333", "e1", 100)
        await service.reserve("333", "expired", 40)
        await service.reserve("333", "confirmed", 20)
        await service.confirmRedemption("confirmed")

        await sql(
          `update "loyalty_entry" set created_at = now() - make_interval(mins => ?) where "externalReference" in ('expired', 'confirmed')`,
          [RESERVATION_TTL_MINUTES + 5]
        )

        expect(await service.availableBalance("333")).toBe(80)
      })

      it("never lets concurrent reservations exceed the balance", async () => {
        await service.earn("444", "e1", 100)

        const results = await Promise.all([1, 2, 3, 4, 5].map((n) => service.reserve("444", `c${n}`, 60)))

        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await service.availableBalance("444")).toBe(40)
      })

      it("counts zero for an unknown document", async () => {
        expect(await service.availableBalance("999")).toBe(0)
      })
    })

    describe("verification codes (real Postgres)", () => {
      it("accepts the right code once", async () => {
        const code = await service.issueCode("555")
        expect(code).toMatch(/^\d{6}$/)
        expect(await service.verifyCode("555", code)).toBe(true)
        expect(await service.verifyCode("555", code)).toBe(false)
      })

      it("locks the code after too many wrong attempts", async () => {
        const code = await service.issueCode("666")
        const wrong = code === "000000" ? "111111" : "000000"
        for (let i = 0; i < 5; i++) expect(await service.verifyCode("666", wrong)).toBe(false)
        expect(await service.verifyCode("666", code)).toBe(false)
      })

      it("rejects an expired code", async () => {
        const code = await service.issueCode("777")
        await sql(`update "loyalty_code" set "expiresAt" = now() - interval '1 minute' where "buyerDocument" = '777'`)
        expect(await service.verifyCode("777", code)).toBe(false)
      })

      it("invalidates the previous code when a new one is issued", async () => {
        const first = await service.issueCode("888")
        const second = await service.issueCode("888")
        if (first !== second) expect(await service.verifyCode("888", first)).toBe(false)
        expect(await service.verifyCode("888", second)).toBe(true)
      })

      it("stores only the code hash", async () => {
        const code = await service.issueCode("1010")
        const rows = await sql(`select * from "loyalty_code" where "buyerDocument" = '1010'`)
        expect(JSON.stringify(rows)).not.toContain(`"${code}"`)
      })

      it("never counts more than the allowed attempts under concurrency", async () => {
        const code = await service.issueCode("1111")
        const wrong = code === "000000" ? "111111" : "000000"

        await Promise.all(Array.from({ length: 10 }, () => service.verifyCode("1111", wrong)))

        const [row] = await sql(`select attempts from "loyalty_code" where "buyerDocument" = '1111'`)
        expect(Number(row.attempts)).toBeLessThanOrEqual(5)
        expect(await service.verifyCode("1111", code)).toBe(false)
      })

      it("tells until when a checkout's reservation holds the points", async () => {
        await service.earn("1212", "e1", 100)
        expect(await service.reservationExpiresAt("none")).toBeNull()

        await service.reserve("1212", "live", 10)
        const expires = await service.reservationExpiresAt("live")
        const minutes = (expires!.getTime() - Date.now()) / 60000
        expect(minutes).toBeGreaterThan(RESERVATION_TTL_MINUTES - 2)
        expect(minutes).toBeLessThanOrEqual(RESERVATION_TTL_MINUTES)

        await service.cancelReservation("live")
        expect(await service.reservationExpiresAt("live")).toBeNull()
      })
    })
  },
})
