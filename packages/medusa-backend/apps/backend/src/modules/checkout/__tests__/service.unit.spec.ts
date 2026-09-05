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
        createCheckoutSnapshots = jest.fn()
        listCheckoutSnapshots = jest.fn()
        updateCheckoutSnapshots = jest.fn()
      },
  }
})

import CheckoutModuleService from "../service"

function makeService() {
  const svc = new CheckoutModuleService() as any
  return svc as CheckoutModuleService & {
    createCheckoutSnapshots: jest.Mock
    listCheckoutSnapshots: jest.Mock
    updateCheckoutSnapshots: jest.Mock
  }
}

describe("CheckoutModuleService.recordSnapshot", () => {
  it("creates a checkout_snapshot with the given externalReference and payload", async () => {
    const svc = makeService()
    svc.createCheckoutSnapshots.mockResolvedValue({ id: "snap_1" })

    const payload = {
      items: [{ title: "Camiseta", quantity: 1, price: 7900 }],
      address: { first_name: "João" },
      shipping: { id: "pac", name: "PAC", price: 2500 },
      total: 10400,
    }
    await svc.recordSnapshot("ext-ref-1", payload)

    expect(svc.createCheckoutSnapshots).toHaveBeenCalledWith({
      externalReference: "ext-ref-1",
      payload,
    })
  })
})

describe("CheckoutModuleService.findByExternalReference", () => {
  it("returns the snapshot matching the external reference", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([{ id: "snap_1", externalReference: "ext-ref-1" }])

    const result = await svc.findByExternalReference("ext-ref-1")

    expect(svc.listCheckoutSnapshots).toHaveBeenCalledWith({ externalReference: "ext-ref-1" })
    expect(result).toEqual({ id: "snap_1", externalReference: "ext-ref-1" })
  })

  it("returns null when no snapshot matches", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([])

    const result = await svc.findByExternalReference("missing-ref")

    expect(result).toBeNull()
  })
})

describe("CheckoutModuleService.attachPreferenceId", () => {
  it("updates the snapshot's preferenceId when the snapshot exists", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([{ id: "snap_1", externalReference: "ext-ref-1" }])
    svc.updateCheckoutSnapshots.mockResolvedValue([{}])

    await svc.attachPreferenceId("ext-ref-1", "pref-abc")

    expect(svc.updateCheckoutSnapshots).toHaveBeenCalledWith({ id: "snap_1", preferenceId: "pref-abc" })
  })

  it("does nothing when no snapshot matches the external reference", async () => {
    const svc = makeService()
    svc.listCheckoutSnapshots.mockResolvedValue([])

    await svc.attachPreferenceId("missing-ref", "pref-abc")

    expect(svc.updateCheckoutSnapshots).not.toHaveBeenCalled()
  })
})
