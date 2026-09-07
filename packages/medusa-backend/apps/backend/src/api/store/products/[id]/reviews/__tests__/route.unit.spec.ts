import { GET } from "../route"

function buildReq(reviews: any[], options?: { query?: Record<string, string>; listImpl?: jest.Mock }) {
  return {
    params: { id: "prod_1" },
    query: options?.query ?? {},
    scope: { resolve: () => ({ listReviews: options?.listImpl ?? jest.fn().mockResolvedValue(reviews) }) },
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

  it("paginates the returned reviews while keeping the average and count over the full published set", async () => {
    const allReviews = [
      { id: "r1", rating: 5, comment: "A", reviewerName: "Maria Silva", created_at: "2026-09-03" },
      { id: "r2", rating: 1, comment: "B", reviewerName: "João Souza", created_at: "2026-09-02" },
      { id: "r3", rating: 5, comment: "C", reviewerName: "Ana Costa", created_at: "2026-09-01" },
    ]
    const pagedReviews = [allReviews[0]]
    const listImpl = jest.fn().mockImplementation((_filters: unknown, config?: any) => {
      if (config && typeof config.take === "number") return Promise.resolve(pagedReviews)
      return Promise.resolve(allReviews)
    })
    const req = buildReq(allReviews, { query: { limit: "1", offset: "0" }, listImpl })
    const res = buildRes()

    await GET(req, res)

    expect(listImpl).toHaveBeenCalledWith(
      { productId: "prod_1", status: "published" },
      expect.objectContaining({ take: 1, skip: 0 })
    )
    expect(res.json).toHaveBeenCalledWith({
      reviews: [{ id: "r1", rating: 5, comment: "A", reviewerName: "Maria S.", created_at: "2026-09-03" }],
      average: Math.round(((5 + 1 + 5) / 3) * 10) / 10,
      count: 3,
    })
  })

  it("defaults to limit 20 and offset 0 when not provided", async () => {
    const listImpl = jest.fn().mockResolvedValue([])
    const req = buildReq([], { listImpl })
    const res = buildRes()

    await GET(req, res)

    expect(listImpl).toHaveBeenCalledWith(
      { productId: "prod_1", status: "published" },
      expect.objectContaining({ take: 20, skip: 0 })
    )
  })
})
