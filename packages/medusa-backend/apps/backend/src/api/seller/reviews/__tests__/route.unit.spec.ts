import { GET } from "../route"

function buildReq(sellerId: string, listImpl: jest.Mock) {
  return {
    sellerId,
    query: {},
    scope: { resolve: () => ({ listReviews: listImpl }) },
  } as any
}

function buildRes() {
  const res: any = {}
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("GET /seller/reviews", () => {
  it("filters by the logged-in seller and defaults to pending status", async () => {
    const listSpy = jest.fn().mockResolvedValue([])
    const req = buildReq("seller_1", listSpy)
    const res = buildRes()

    await GET(req, res)

    expect(listSpy).toHaveBeenCalledWith(
      { sellerId: "seller_1", status: "pending" },
      expect.anything()
    )
  })
})
