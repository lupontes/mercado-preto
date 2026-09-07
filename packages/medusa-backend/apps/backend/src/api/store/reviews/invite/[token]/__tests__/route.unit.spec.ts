jest.mock("../../../../../../utils/review-jwt", () => {
  const actual = jest.requireActual("../../../../../../utils/review-jwt")
  return { ...actual, verifyReviewToken: jest.fn(actual.verifyReviewToken) }
})

import { GET } from "../route"
import { verifyReviewToken } from "../../../../../../utils/review-jwt"

function buildReq(token: string, orderData: Record<string, unknown> | null, graphData: unknown[] = [], reviewData: unknown[] = []) {
  return {
    params: { token },
    scope: {
      resolve: (key: string) => {
        if (key === "review") return { listReviews: jest.fn().mockResolvedValue(reviewData) }
        if (key === "query") return { graph: jest.fn().mockResolvedValue({ data: graphData }) }
        return { retrieveOrder: jest.fn().mockResolvedValue(orderData) }
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

describe("GET /store/reviews/invite/[token]", () => {
  afterEach(() => jest.clearAllMocks())

  it("returns 400 for an invalid token", async () => {
    const req = buildReq("token-invalido", null)
    const res = buildRes()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("returns the reviewable products for a valid token", async () => {
    ;(verifyReviewToken as jest.Mock).mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", items: [{ variant_id: "variant_1" }] }
    const graphData = [{ id: "variant_1", product: { id: "prod_1", title: "Cesta de Vime", thumbnail: "https://x/img.jpg" } }]
    const req = buildReq("token-valido", order, graphData, [])
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: "https://x/img.jpg", alreadyReviewed: false }],
    })
  })

  it("marks a product as already reviewed", async () => {
    ;(verifyReviewToken as jest.Mock).mockReturnValue({ orderId: "order_1", type: "review", iat: 0, exp: 9999999999 })
    const order = { id: "order_1", items: [{ variant_id: "variant_1" }] }
    const graphData = [{ id: "variant_1", product: { id: "prod_1", title: "Cesta de Vime", thumbnail: null } }]
    const existingReview = [{ productId: "prod_1" }]
    const req = buildReq("token-valido", order, graphData, existingReview)
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: null, alreadyReviewed: true }],
    })
  })
})
