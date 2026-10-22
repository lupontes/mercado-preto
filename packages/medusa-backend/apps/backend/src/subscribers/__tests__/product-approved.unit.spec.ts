import { ContainerRegistrationKeys, Modules, mergeMetadata } from "@medusajs/framework/utils"
import productApproved, { config } from "../product-approved"
import { notifySellerProductApproved } from "../../utils/product-moderation-notify"

jest.mock("../../utils/product-moderation-notify", () => ({
  notifySellerProductApproved: jest.fn(),
}))

const seller = { name: "Loja", phone: "5511999999999", email: "loja@example.com" }

function run(product: Record<string, unknown> | null) {
  const graph = jest.fn().mockResolvedValue({ data: product ? [product] : [] })
  const updateProducts = jest.fn().mockResolvedValue({})
  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === Modules.PRODUCT) return { updateProducts }
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  const done = productApproved({ event: { data: { id: "prod_1" } }, container } as any)
  return { done, updateProducts, graph }
}

const base = { id: "prod_1", title: "Colar", handle: "colar", seller }

describe("productApproved", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, "error").mockImplementation(() => {})
  })

  it("listens to product.updated", () => {
    expect(config.event).toBe("product.updated")
  })

  it("records approved_at, drops submitted_at and notifies on a reviewed first publication", async () => {
    const metadata = { submitted_at: "2026-10-01T00:00:00.000Z", other: "keep" }
    const { done, updateProducts } = run({ ...base, status: "published", metadata })
    await done

    expect(updateProducts).toHaveBeenCalledTimes(1)
    const [id, payload] = updateProducts.mock.calls[0]
    expect(id).toBe("prod_1")
    expect(payload.metadata.approved_at).toEqual(expect.any(String))
    expect(payload.metadata.submitted_at).toBe("")
    expect(payload.metadata.other).toBe("keep")

    // Medusa keeps stored keys missing from the update; only "" deletes one.
    const merged = mergeMetadata(metadata, payload.metadata)
    expect(merged).not.toHaveProperty("submitted_at")
    expect(merged.approved_at).toBe(payload.metadata.approved_at)

    expect(notifySellerProductApproved).toHaveBeenCalledTimes(1)
    expect(notifySellerProductApproved).toHaveBeenCalledWith(
      seller,
      { id: "prod_1", title: "Colar", handle: "colar" },
      "new"
    )
  })

  it("records approved_at without notifying when there was no submission", async () => {
    const { done, updateProducts } = run({ ...base, status: "published", metadata: null })
    await done
    expect(updateProducts).toHaveBeenCalledTimes(1)
    expect(updateProducts.mock.calls[0][1].metadata.approved_at).toEqual(expect.any(String))
    expect(notifySellerProductApproved).not.toHaveBeenCalled()
  })

  it("is a no-op on the event fired by its own update (approved_at present)", async () => {
    const { done, updateProducts } = run({
      ...base,
      status: "published",
      metadata: { approved_at: "2026-10-02T00:00:00.000Z" },
    })
    await done
    expect(updateProducts).not.toHaveBeenCalled()
    expect(notifySellerProductApproved).not.toHaveBeenCalled()
  })

  it.each(["draft", "proposed"])("does nothing for %s products", async (status) => {
    const { done, updateProducts } = run({ ...base, status, metadata: { submitted_at: "x" } })
    await done
    expect(updateProducts).not.toHaveBeenCalled()
    expect(notifySellerProductApproved).not.toHaveBeenCalled()
  })

  it("does nothing when the product is not found", async () => {
    const { done, updateProducts } = run(null)
    await done
    expect(updateProducts).not.toHaveBeenCalled()
  })

  it("does not throw when the notification fails", async () => {
    ;(notifySellerProductApproved as jest.Mock).mockRejectedValueOnce(new Error("boom"))
    const { done, updateProducts } = run({
      ...base,
      status: "published",
      metadata: { submitted_at: "x" },
    })
    await expect(done).resolves.toBeUndefined()
    expect(updateProducts).toHaveBeenCalledTimes(1)
  })
})
