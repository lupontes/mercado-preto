// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ProdutosPage from "../page"
import * as sellerApi from "@/lib/seller-api"

function product(overrides: Record<string, unknown>) {
  return { id: "p1", title: "Produto", variants: [], categories: [], ...overrides }
}

describe("ProdutosPage status badges", () => {
  afterEach(() => vi.restoreAllMocks())

  it("labels proposed products as 'Em análise'", async () => {
    vi.spyOn(sellerApi, "getSellerProducts").mockResolvedValue({ products: [product({ status: "proposed" })], count: 1 })
    render(<ProdutosPage />)
    expect(await screen.findByText("Em análise")).toBeInTheDocument()
  })

  it("labels a published product with pending changes", async () => {
    vi.spyOn(sellerApi, "getSellerProducts").mockResolvedValue({
      products: [product({ status: "published", metadata: { pending_changes: { title: "x" } } })],
      count: 1,
    })
    render(<ProdutosPage />)
    expect(await screen.findByText("Publicado · alteração em análise")).toBeInTheDocument()
  })

  it("labels a published product without pending changes as 'Publicado'", async () => {
    vi.spyOn(sellerApi, "getSellerProducts").mockResolvedValue({ products: [product({ status: "published", metadata: {} })], count: 1 })
    render(<ProdutosPage />)
    expect(await screen.findByText("Publicado")).toBeInTheDocument()
  })
})
