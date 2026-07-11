// ---------------------------------------------------------------------------
// Mock @medusajs/framework/utils BEFORE importing the service.
// Spread the real module so that `model`, `Module`, etc. remain intact —
// only MedusaService is replaced to avoid database initialization.
// ---------------------------------------------------------------------------
jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        listCommissions = jest.fn()
        updateCommissions = jest.fn()
      },
  }
})

import CommissionModuleService from "../service"

function makeService() {
  const svc = new CommissionModuleService() as any
  return svc as CommissionModuleService & {
    listCommissions: jest.Mock
    updateCommissions: jest.Mock
  }
}

describe("CommissionModuleService.linkPendingToPayout", () => {
  it("links only pending commissions within the period to the payout", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([
      { id: "comm_1", sellerId: "seller_1", status: "pending", created_at: "2026-07-05T00:00:00.000Z" },
      { id: "comm_2", sellerId: "seller_1", status: "pending", created_at: "2026-07-20T00:00:00.000Z" },
    ])
    svc.updateCommissions.mockResolvedValue([{}])

    await svc.linkPendingToPayout(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T23:59:59.999Z"),
      "payout_1"
    )

    expect(svc.listCommissions).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending" })
    expect(svc.updateCommissions).toHaveBeenCalledTimes(1)
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_1" },
      data: { payoutId: "payout_1" },
    })
  })

  it("does nothing when there are no pending commissions in the period", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([])

    await svc.linkPendingToPayout(
      "seller_1",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T00:00:00.000Z"),
      "payout_1"
    )

    expect(svc.updateCommissions).not.toHaveBeenCalled()
  })
})

describe("CommissionModuleService.markPaidByPayout", () => {
  it("marks all commissions linked to the payout as paid", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([
      { id: "comm_1", payoutId: "payout_1" },
      { id: "comm_2", payoutId: "payout_1" },
    ])
    svc.updateCommissions.mockResolvedValue([{}])

    await svc.markPaidByPayout("payout_1")

    expect(svc.listCommissions).toHaveBeenCalledWith({ payoutId: "payout_1" })
    expect(svc.updateCommissions).toHaveBeenCalledTimes(2)
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_1" },
      data: expect.objectContaining({ status: "paid" }),
    })
    expect(svc.updateCommissions).toHaveBeenCalledWith({
      selector: { id: "comm_2" },
      data: expect.objectContaining({ status: "paid" }),
    })
  })

  it("does nothing when no commissions are linked to the payout", async () => {
    const svc = makeService()
    svc.listCommissions.mockResolvedValue([])

    await svc.markPaidByPayout("payout_empty")

    expect(svc.updateCommissions).not.toHaveBeenCalled()
  })
})
