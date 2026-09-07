jest.mock("../../utils/review-jwt", () => ({ createReviewToken: jest.fn() }))
jest.mock("../../utils/email", () => ({ sendBrevoEmail: jest.fn() }))

import orderReviewInviteEmail, { config } from "../order-review-invite-email"
import { sendBrevoEmail } from "../../utils/email"
import { createReviewToken } from "../../utils/review-jwt"

function buildContainer(order: Record<string, unknown> | null) {
  return {
    resolve: () => ({
      retrieveOrder: jest.fn().mockResolvedValue(order),
    }),
  }
}

describe("orderReviewInviteEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("sends a review invite email when the order has a buyer email", async () => {
    ;(createReviewToken as jest.Mock).mockReturnValue("signed-token")
    ;(sendBrevoEmail as jest.Mock).mockResolvedValue(undefined)
    const container = buildContainer({ id: "order_1", email: "cliente@teste.com", display_id: 42 })

    await orderReviewInviteEmail({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendBrevoEmail).toHaveBeenCalledWith(
      "cliente@teste.com",
      expect.any(String),
      expect.stringContaining("signed-token")
    )
  })

  it("does nothing when the order has no buyer email", async () => {
    ;(sendBrevoEmail as jest.Mock).mockResolvedValue(undefined)
    const container = buildContainer({ id: "order_1", email: null, display_id: 42 })

    await orderReviewInviteEmail({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendBrevoEmail).not.toHaveBeenCalled()
  })

  it("does nothing when the order is not found", async () => {
    ;(sendBrevoEmail as jest.Mock).mockResolvedValue(undefined)
    const container = buildContainer(null)

    await orderReviewInviteEmail({ event: { data: { id: "order_1" } }, container } as any)

    expect(sendBrevoEmail).not.toHaveBeenCalled()
  })

  it("listens to order.completed", () => {
    expect(config.event).toBe("order.completed")
  })
})
