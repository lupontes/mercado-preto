jest.mock("../../../../utils/review-jwt", () => {
  const actual = jest.requireActual("../../../../utils/review-jwt")
  return { ...actual, verifyReviewToken: jest.fn(actual.verifyReviewToken) }
})

import { POST } from "../route"
import { verifyReviewToken } from "../../../../utils/review-jwt"

function buildReq(body: Record<string, unknown>, order: Record<string, unknown> | null, createImpl?: jest.Mock) {
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === "review") return { createReviews: createImpl ?? jest.fn().mockResolvedValue({ id: "review_1", status: "pending" }) }
        return { retrieveOrder: jest.fn().mockResolvedValue(order) }
      },
    },
  } as any
}

function buildRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("POST /store/reviews", () => {
  afterEach(() => jest.clearAllMocks())

  it("returns 400 for an invalid token", async () => {
    const req = buildReq({ token: "invalido", productId: "prod_1", rating: 5 }, null)
    const res = buildRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("returns 400 for a rating outside 1-5", async () => {
    ;(verifyReviewToken as jest.Mock).mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const req = buildReq({ token: "valido", productId: "prod_1", rating: 6 }, { id: "order_1", metadata: { seller_id: "seller_1" }, email: "a@a.com" })
    const res = buildRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("creates a review resolving sellerId from the order, never from the request body", async () => {
    ;(verifyReviewToken as jest.Mock).mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", metadata: { seller_id: "seller_1" }, email: "cliente@teste.com", shipping_address: { first_name: "Maria" } }
    const createSpy = jest.fn().mockResolvedValue({ id: "review_1", status: "pending" })
    const req = buildReq({ token: "valido", productId: "prod_1", rating: 5, comment: "Ótimo", sellerId: "seller-forjado" }, order, createSpy)
    const res = buildRes()

    await POST(req, res)

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order_1",
      productId: "prod_1",
      sellerId: "seller_1",
      rating: 5,
    }))
    expect(res.json).toHaveBeenCalledWith({ review: { id: "review_1", status: "pending" } })
  })

  it("returns 409 when the product was already reviewed for this order", async () => {
    ;(verifyReviewToken as jest.Mock).mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", metadata: { seller_id: "seller_1" }, email: "cliente@teste.com", shipping_address: { first_name: "Maria" } }
    const duplicateError = Object.assign(new Error("duplicate key value"), { code: "23505" })
    const createSpy = jest.fn().mockRejectedValue(duplicateError)
    const req = buildReq({ token: "valido", productId: "prod_1", rating: 5 }, order, createSpy)
    const res = buildRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
  })
})
