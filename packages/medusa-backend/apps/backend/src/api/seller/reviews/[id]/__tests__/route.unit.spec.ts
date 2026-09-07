import { PATCH } from "../route"

function buildReq(sellerId: string, id: string, body: Record<string, unknown>, existing: Record<string, unknown> | null, updateImpl?: jest.Mock) {
  return {
    sellerId,
    params: { id },
    body,
    scope: {
      resolve: () => ({
        retrieveReview: jest.fn().mockResolvedValue(existing),
        updateReviews: updateImpl ?? jest.fn().mockResolvedValue([{ id, status: body.status }]),
      }),
    },
  } as any
}

function buildRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe("PATCH /seller/reviews/[id]", () => {
  it("returns 400 for an invalid status", async () => {
    const req = buildReq("seller_1", "review_1", { status: "invalido" }, { id: "review_1", sellerId: "seller_1" })
    const res = buildRes()

    await PATCH(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("returns 404 when the review does not belong to the logged-in seller", async () => {
    const req = buildReq("seller_1", "review_1", { status: "published" }, { id: "review_1", sellerId: "outro-vendedor" })
    const res = buildRes()

    await PATCH(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it("updates the review status when it belongs to the logged-in seller", async () => {
    const updateSpy = jest.fn().mockResolvedValue([{ id: "review_1", status: "published" }])
    const req = buildReq("seller_1", "review_1", { status: "published" }, { id: "review_1", sellerId: "seller_1" }, updateSpy)
    const res = buildRes()

    await PATCH(req, res)

    expect(updateSpy).toHaveBeenCalledWith({ selector: { id: "review_1" }, data: { status: "published" } })
    expect(res.json).toHaveBeenCalledWith({ review: { id: "review_1", status: "published" } })
  })
})
