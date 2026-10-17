import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { CHECKOUT_MODULE } from ".."
import CheckoutModuleService from "../service"

jest.setTimeout(60000)

moduleIntegrationTestRunner<CheckoutModuleService>({
  moduleName: CHECKOUT_MODULE,
  resolve: "./src/modules/checkout",
  testSuite: ({ service }) => {
    describe("CheckoutModuleService snapshot transitions (real Postgres)", () => {
      it("transitions a new snapshot from pending exactly once", async () => {
        await service.recordSnapshot("ref-1", { total: 100 })

        expect(await service.transitionFromPending("ref-1", "paid", "p1")).toBe(true)
        const snapshot = await service.findByExternalReference("ref-1")
        expect(snapshot.status).toBe("paid")
        expect(snapshot.paymentId).toBe("p1")

        expect(await service.transitionFromPending("ref-1", "paid", "p2")).toBe(false)
        const again = await service.findByExternalReference("ref-1")
        expect(again.paymentId).toBe("p1")
      })

      it("lets exactly one of several concurrent transitions win", async () => {
        await service.recordSnapshot("ref-2", { total: 100 })

        const results = await Promise.all(
          [1, 2, 3, 4, 5].map((n) => service.transitionFromPending("ref-2", "paid", `p${n}`))
        )

        expect(results.filter(Boolean)).toHaveLength(1)
      })

      it("accepts the transition for legacy snapshots with a null status", async () => {
        await service.recordSnapshot("ref-3", { total: 100 })
        const snapshot = await service.findByExternalReference("ref-3")
        expect(snapshot.status ?? null).toBeNull()

        expect(await service.transitionFromPending("ref-3", "paid", "p1")).toBe(true)
      })

      it("does not move amount_mismatch back to paid", async () => {
        await service.recordSnapshot("ref-4", { total: 100 })
        expect(await service.transitionFromPending("ref-4", "amount_mismatch", "p1")).toBe(true)

        expect(await service.transitionFromPending("ref-4", "paid", "p2")).toBe(false)
        const snapshot = await service.findByExternalReference("ref-4")
        expect(snapshot.status).toBe("amount_mismatch")
      })

      it("claims order creation once and again only after release", async () => {
        await service.recordSnapshot("ref-5", { total: 100 })

        expect(await service.claimOrderCreation("ref-5")).toBe(true)
        expect(await service.claimOrderCreation("ref-5")).toBe(false)

        await service.releaseOrderCreation("ref-5")
        expect(await service.claimOrderCreation("ref-5")).toBe(true)
      })
    })
  },
})
