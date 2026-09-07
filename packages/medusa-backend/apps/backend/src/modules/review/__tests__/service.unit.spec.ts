jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        createReviews = jest.fn().mockResolvedValue({ id: "review_1", orderId: "order_1", status: "pending" })
      },
  }
})

import ReviewModuleService from "../service"

describe("ReviewModuleService", () => {
  it("exposes createReviews from the generated MedusaService CRUD", async () => {
    const service = new ReviewModuleService() as any

    const review = await service.createReviews({
      orderId: "order_1",
      productId: "prod_1",
      sellerId: "seller_1",
      rating: 5,
      comment: "Produto ótimo!",
      reviewerName: "Maria Silva",
    })

    expect(review.orderId).toBe("order_1")
    expect(review.status).toBe("pending")
  })
})
