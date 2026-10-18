import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { CHECKOUT_MODULE } from ".."
import CheckoutModuleService from "../service"

jest.setTimeout(60000)

moduleIntegrationTestRunner<CheckoutModuleService>({
  moduleName: CHECKOUT_MODULE,
  resolve: "./src/modules/checkout",
  testSuite: ({ service, MikroOrmWrapper }) => {
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

      // Set through SQL so the age is measured against the database clock, the
      // same clock the claim's staleness check uses.
      async function claimedMinutesAgo(externalReference: string, minutes: number) {
        await MikroOrmWrapper.forkManager().execute(
          `update "checkout_snapshot" set "ordersCreatedAt" = now() - make_interval(mins => ?)
           where "externalReference" = ?`,
          [minutes, externalReference]
        )
      }

      it("lets a stale claim be taken again", async () => {
        await service.recordSnapshot("ref-6", { total: 100 })
        await claimedMinutesAgo("ref-6", 11)

        expect(await service.claimOrderCreation("ref-6")).toBe(true)
        expect(await service.claimOrderCreation("ref-6")).toBe(false)
      })

      it("keeps a recent claim", async () => {
        await service.recordSnapshot("ref-7", { total: 100 })
        await claimedMinutesAgo("ref-7", 1)

        expect(await service.claimOrderCreation("ref-7")).toBe(false)
      })

      it("finds the e-mail of the latest paid checkout for a document", async () => {
        const payload = (email: string, doc = "52998224725") => ({ total: 100, buyer_document: doc, address: { email } })
        await service.recordSnapshot("old", payload("antigo@example.com"), { status: "pending" })
        await service.transitionFromPending("old", "paid", "p1")
        await service.recordSnapshot("new", payload("novo@example.com"), { status: "pending" })
        await service.transitionFromPending("new", "paid", "p2")
        await service.recordSnapshot("unpaid", payload("naopago@example.com"), { status: "pending" })
        await service.recordSnapshot("other", payload("outro@example.com", "11144477735"), { status: "pending" })
        await service.transitionFromPending("other", "paid", "p3")

        expect(await service.findLatestPaidEmail("52998224725")).toBe("novo@example.com")
        expect(await service.findLatestPaidEmail("00000000000")).toBeNull()
      })
    })
  },
})
