jest.mock("../../utils/meilisearch", () => ({
  indexProduct: jest.fn(),
  removeProduct: jest.fn(),
  indexSeller: jest.fn(),
  removeSeller: jest.fn(),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import productSearchIndex, { config as productIndexConfig } from "../product-search-index"
import productSearchRemove, { config as productRemoveConfig } from "../product-search-remove"
import sellerSearchIndex, { config as sellerIndexConfig } from "../seller-search-index"
import { indexProduct, indexSeller, removeProduct, removeSeller } from "../../utils/meilisearch"

const event = (id: string) => ({ data: { id } }) as any

function productContainer(product: Record<string, unknown> | undefined) {
  const graph = jest.fn().mockResolvedValue({ data: product ? [product] : [] })
  return { resolve: (key: string) => (key === ContainerRegistrationKeys.QUERY ? { graph } : undefined) } as any
}

function sellerContainer(seller: Record<string, unknown> | undefined) {
  const listSellers = jest.fn().mockResolvedValue(seller ? [seller] : [])
  return { resolve: (key: string) => (key === "seller" ? { listSellers } : undefined) } as any
}

const storedSeller = (status: string) => ({
  id: "seller_1", name: "Loja", bio: "Bio", category: "moda", location: "Salvador", status,
  email: "loja@example.com", passwordHash: "salt:hash", cpfCnpj: "52998224725",
})

describe("product search index", () => {
  beforeEach(() => jest.clearAllMocks())

  it("upserts a published product", async () => {
    await productSearchIndex({ event: event("prod_1"), container: productContainer({ id: "prod_1", status: "published", seller: { id: "s1" } }) } as any)
    expect(indexProduct).toHaveBeenCalledWith(expect.objectContaining({ id: "prod_1", status: "published" }))
  })

  it("keeps a draft product indexed as draft, so search filters it out", async () => {
    await productSearchIndex({ event: event("prod_1"), container: productContainer({ id: "prod_1", status: "draft" }) } as any)
    expect(indexProduct).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }))
  })

  it("listens to creation and updates only", () => {
    expect(productIndexConfig.event).toEqual(["product.created", "product.updated"])
  })

  it("removes a deleted product", async () => {
    await productSearchRemove({ event: event("prod_9"), container: productContainer(undefined) } as any)
    expect(removeProduct).toHaveBeenCalledWith("prod_9")
    expect(productRemoveConfig.event).toBe("product.deleted")
  })
})

describe("seller search index", () => {
  beforeEach(() => jest.clearAllMocks())

  it("upserts an active seller with public fields only", async () => {
    await sellerSearchIndex({ event: event("seller_1"), container: sellerContainer(storedSeller("active")) } as any)

    expect(removeSeller).not.toHaveBeenCalled()
    const doc = (indexSeller as jest.Mock).mock.calls[0][0]
    expect(doc).toMatchObject({ id: "seller_1", status: "active" })
    expect(JSON.stringify(doc)).not.toMatch(/loja@example\.com|salt:hash|52998224725/)
  })

  it.each(["approved", "pending", "suspended"])("removes a %s seller", async (status) => {
    await sellerSearchIndex({ event: event("seller_1"), container: sellerContainer(storedSeller(status)) } as any)
    expect(removeSeller).toHaveBeenCalledWith("seller_1")
    expect(indexSeller).not.toHaveBeenCalled()
  })

  it("removes a seller that no longer exists", async () => {
    await sellerSearchIndex({ event: event("seller_1"), container: sellerContainer(undefined) } as any)
    expect(removeSeller).toHaveBeenCalledWith("seller_1")
  })

  it("listens to approval and every status change", () => {
    expect(sellerIndexConfig.event).toEqual(["seller.approved", "seller.status_changed"])
  })
})
