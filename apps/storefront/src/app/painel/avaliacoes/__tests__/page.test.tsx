// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AvaliacoesPage from "../page"
import * as sellerApi from "@/lib/seller-api"

describe("AvaliacoesPage", () => {
  it("lists pending reviews and approves one", async () => {
    vi.spyOn(sellerApi, "getSellerReviews").mockResolvedValue({
      reviews: [{ id: "r1", productId: "prod_1", rating: 5, comment: "Ótimo", reviewerName: "Maria S.", created_at: "2026-09-01" }],
      count: 1,
    })
    const updateSpy = vi.spyOn(sellerApi, "updateReviewStatus").mockResolvedValue({ review: { id: "r1", status: "published" } })

    render(<AvaliacoesPage />)

    expect(await screen.findByText("Ótimo")).toBeInTheDocument()
    const user = (await import("@testing-library/user-event")).default.setup()
    await user.click(screen.getByRole("button", { name: "Aprovar" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("r1", "published"))
  })

  it("shows an empty state with no pending reviews", async () => {
    vi.spyOn(sellerApi, "getSellerReviews").mockResolvedValue({ reviews: [], count: 0 })

    render(<AvaliacoesPage />)

    expect(await screen.findByText(/Nenhuma avaliação pendente/)).toBeInTheDocument()
  })
})
