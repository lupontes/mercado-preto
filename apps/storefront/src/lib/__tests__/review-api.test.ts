import { afterEach, describe, expect, it, vi } from "vitest"
import { getReviewInvite, submitReview } from "../review-api"

describe("review-api", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("getReviewInvite fetches the invite by token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) })
    vi.stubGlobal("fetch", fetchMock)

    await getReviewInvite("tok_1")

    expect(fetchMock.mock.calls[0][0]).toContain("/store/reviews/invite/tok_1")
  })

  it("submitReview posts the rating and comment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ review: { id: "r1", status: "pending" } }) })
    vi.stubGlobal("fetch", fetchMock)

    await submitReview({ token: "tok_1", productId: "prod_1", rating: 5, comment: "Ótimo" })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/store/reviews")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ token: "tok_1", productId: "prod_1", rating: 5, comment: "Ótimo" })
  })
})
