jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        listPayouts = jest.fn()
        updatePayouts = jest.fn()
      },
  }
})

import PayoutModuleService from "../service"

function makeService() {
  const svc = new PayoutModuleService() as any
  return svc as PayoutModuleService & {
    listPayouts: jest.Mock
    updatePayouts: jest.Mock
  }
}

describe("PayoutModuleService.cancelPayout", () => {
  it("sets status to cancelled", async () => {
    const svc = makeService()
    svc.updatePayouts.mockResolvedValue([{ id: "payout_1", status: "cancelled" }])

    await svc.cancelPayout("payout_1")

    expect(svc.updatePayouts).toHaveBeenCalledWith({
      selector: { id: "payout_1" },
      data: { status: "cancelled" },
    })
  })
})

describe("PayoutModuleService.incrementAmount", () => {
  it("adds the delta to the current amount", async () => {
    const svc = makeService()
    svc.listPayouts.mockResolvedValue([{ id: "payout_1", amount: 1000 }])
    svc.updatePayouts.mockResolvedValue([{ id: "payout_1", amount: 1500 }])

    await svc.incrementAmount("payout_1", 500)

    expect(svc.listPayouts).toHaveBeenCalledWith({ id: "payout_1" })
    expect(svc.updatePayouts).toHaveBeenCalledWith({
      selector: { id: "payout_1" },
      data: { amount: 1500 },
    })
  })
})
