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
        updateSellers = jest.fn()
      },
  }
})

import SellerModuleService from "../service"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService() {
  const svc = new SellerModuleService() as any

  svc.updateSellers = jest.fn().mockImplementation(async ({ selector, data }: any) => [
    { id: selector.id, ...data },
  ])

  return svc as SellerModuleService & { updateSellers: jest.Mock }
}

// ---------------------------------------------------------------------------
// activateSeller
// ---------------------------------------------------------------------------

describe("SellerModuleService.activateSeller", () => {
  it("sets status to active and clears rejectionReason", async () => {
    const svc = makeService()

    const seller = await svc.activateSeller("seller_1")

    expect(svc.updateSellers).toHaveBeenCalledWith({
      selector: { id: "seller_1" },
      data: { status: "active", rejectionReason: null },
    })
    expect(seller).toMatchObject({ id: "seller_1", status: "active", rejectionReason: null })
  })
})

// ---------------------------------------------------------------------------
// approveSeller
// ---------------------------------------------------------------------------

describe("SellerModuleService.approveSeller", () => {
  it("sets status to approved and clears rejectionReason", async () => {
    const svc = makeService()

    await svc.approveSeller("seller_1")

    expect(svc.updateSellers).toHaveBeenCalledWith({
      selector: { id: "seller_1" },
      data: { status: "approved", rejectionReason: null },
    })
  })
})
