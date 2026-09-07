// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ProductReviews } from "../ProductReviews"

describe("ProductReviews", () => {
  it("shows the average rating and each review", () => {
    render(
      <ProductReviews
        average={4.5}
        count={2}
        reviews={[
          { id: "r1", rating: 5, comment: "Ótimo", reviewerName: "Maria S.", created_at: "2026-09-01T00:00:00Z" },
          { id: "r2", rating: 4, comment: null, reviewerName: "João S.", created_at: "2026-09-02T00:00:00Z" },
        ]}
      />
    )

    expect(screen.getByText("4.5")).toBeInTheDocument()
    expect(screen.getByText("Ótimo")).toBeInTheDocument()
    expect(screen.getByText("Maria S.")).toBeInTheDocument()
  })

  it("shows an empty state when there are no reviews yet", () => {
    render(<ProductReviews average={null} count={0} reviews={[]} />)

    expect(screen.getByText(/Nenhuma avaliação ainda/)).toBeInTheDocument()
  })
})
