import { GET } from "../route"

function buildReq(reviews: any[]) {
  return {
    params: { id: "prod_1" },
    query: {},
    scope: { resolve: () => ({ listReviews: jest.fn().mockResolvedValue(reviews) }) },
  } as any
}

function buildRes() {
  const res: any = {}
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("GET /store/products/[id]/reviews", () => {
  it("returns published reviews with the average rating", async () => {
    const reviews = [
      { id: "r1", rating: 5, comment: "Ótimo", reviewerName: "Maria Silva", created_at: "2026-09-01" },
      { id: "r2", rating: 3, comment: null, reviewerName: "João Souza", created_at: "2026-09-02" },
    ]
    const req = buildReq(reviews)
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({
      reviews: [
        { id: "r1", rating: 5, comment: "Ótimo", reviewerName: "Maria S.", created_at: "2026-09-01" },
        { id: "r2", rating: 3, comment: null, reviewerName: "João S.", created_at: "2026-09-02" },
      ],
      average: 4,
      count: 2,
    })
  })

  it("returns average null when there are no published reviews", async () => {
    const req = buildReq([])
    const res = buildRes()

    await GET(req, res)

    expect(res.json).toHaveBeenCalledWith({ reviews: [], average: null, count: 0 })
  })
})
