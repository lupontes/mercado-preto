// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import AvaliarPage from "../page"
import * as reviewApi from "@/lib/review-api"

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "tok_1" }),
}))

describe("AvaliarPage", () => {
  afterEach(() => vi.restoreAllMocks())

  it("lists the reviewable products from the invite", async () => {
    vi.spyOn(reviewApi, "getReviewInvite").mockResolvedValue({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: undefined, alreadyReviewed: false }],
    })

    render(<AvaliarPage />)

    expect(await screen.findByText("Cesta de Vime")).toBeInTheDocument()
  })

  it("shows an already-reviewed product as disabled instead of hiding it", async () => {
    vi.spyOn(reviewApi, "getReviewInvite").mockResolvedValue({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: undefined, alreadyReviewed: true }],
    })

    render(<AvaliarPage />)

    expect(await screen.findByText("Avaliado ✓")).toBeInTheDocument()
  })

  it("submits a rating and comment for a product", async () => {
    vi.spyOn(reviewApi, "getReviewInvite").mockResolvedValue({
      items: [{ productId: "prod_1", title: "Cesta de Vime", thumbnail: undefined, alreadyReviewed: false }],
    })
    const submitSpy = vi.spyOn(reviewApi, "submitReview").mockResolvedValue({ review: { id: "r1", status: "pending" } })
    const user = userEvent.setup()

    render(<AvaliarPage />)
    await screen.findByText("Cesta de Vime")
    await user.click(screen.getByLabelText("5 estrelas"))
    await user.type(screen.getByLabelText(/Comentário/), "Produto ótimo!")
    await user.click(screen.getByRole("button", { name: "Enviar avaliação" }))

    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith({
      token: "tok_1",
      productId: "prod_1",
      rating: 5,
      comment: "Produto ótimo!",
    }))
  })
})
