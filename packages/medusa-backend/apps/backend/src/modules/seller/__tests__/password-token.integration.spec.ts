import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { SELLER_MODULE } from ".."
import SellerModuleService from "../service"

jest.setTimeout(60000)

moduleIntegrationTestRunner<SellerModuleService>({
  moduleName: SELLER_MODULE,
  resolve: "./src/modules/seller",
  testSuite: ({ service }) => {
    describe("SellerModuleService password tokens (real Postgres)", () => {
      const HOUR = 60 * 60 * 1000

      it("consumes a fresh token exactly once", async () => {
        const raw = await service.issuePasswordToken("seller_1", HOUR)

        expect(await service.consumePasswordToken(raw)).toBe("seller_1")
        expect(await service.consumePasswordToken(raw)).toBeNull()
      })

      it("lets exactly one of several concurrent consumptions win", async () => {
        const raw = await service.issuePasswordToken("seller_2", HOUR)

        const results = await Promise.all([1, 2, 3, 4, 5].map(() => service.consumePasswordToken(raw)))

        expect(results.filter((r) => r !== null)).toEqual(["seller_2"])
      })

      it("rejects an expired token", async () => {
        const raw = await service.issuePasswordToken("seller_3", -1000)
        expect(await service.consumePasswordToken(raw)).toBeNull()
      })

      it("invalidates older unused tokens when a new one is issued", async () => {
        const older = await service.issuePasswordToken("seller_4", HOUR)
        const newer = await service.issuePasswordToken("seller_4", HOUR)

        expect(await service.consumePasswordToken(older)).toBeNull()
        expect(await service.consumePasswordToken(newer)).toBe("seller_4")
      })

      it("does not touch other sellers' tokens when issuing", async () => {
        const other = await service.issuePasswordToken("seller_5", HOUR)
        await service.issuePasswordToken("seller_6", HOUR)

        expect(await service.consumePasswordToken(other)).toBe("seller_5")
      })

      it("stores only the token hash", async () => {
        const raw = await service.issuePasswordToken("seller_7", HOUR)
        const rows = await service.listSellerPasswordTokens({ sellerId: "seller_7" })

        expect(rows).toHaveLength(1)
        expect(rows[0].tokenHash).toBe(SellerModuleService.hashToken(raw))
        expect(JSON.stringify(rows)).not.toContain(raw)
      })

      it("returns null for an unknown token", async () => {
        expect(await service.consumePasswordToken("nao-existe")).toBeNull()
      })
    })
  },
})
