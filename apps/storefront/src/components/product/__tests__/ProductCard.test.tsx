// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProductCard } from "../ProductCard"
import { formatPrice, type Product } from "@/lib/api"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const baseProduct: Product = {
  id: "prod_1",
  title: "Colar Artesanal",
  handle: "colar-artesanal",
  status: "published",
  thumbnail: "https://example.com/colar.jpg",
  variants: [
    {
      id: "variant_1",
      title: "Default",
      prices: [{ amount: 4990, currency_code: "brl" }],
    },
  ],
}

describe("ProductCard", () => {
  it("renders the product title and thumbnail image", () => {
    render(<ProductCard product={baseProduct} />)

    expect(screen.getByText("Colar Artesanal")).toBeInTheDocument()
    const img = screen.getByRole("img", { name: "Colar Artesanal" })
    expect(img).toHaveAttribute("src", "https://example.com/colar.jpg")
  })

  it("renders the formatted BRL price when available", () => {
    render(<ProductCard product={baseProduct} />)

    // formatPrice() returns a non-breaking space (U+00A0) between "R$" and
    // the amount; the default text normalizer collapses it differently on
    // each side of the comparison, so disable normalization here.
    expect(
      screen.getByText(formatPrice(4990), { normalizer: (text) => text })
    ).toBeInTheDocument()
  })

  it("renders a fallback message when there is no BRL price", () => {
    const productWithoutBrl: Product = {
      ...baseProduct,
      variants: [
        {
          id: "variant_1",
          title: "Default",
          prices: [{ amount: 4990, currency_code: "usd" }],
        },
      ],
    }

    render(<ProductCard product={productWithoutBrl} />)

    expect(screen.getByText("Consulte o preço")).toBeInTheDocument()
  })

  it("links to the product detail page using the product handle", () => {
    render(<ProductCard product={baseProduct} />)

    expect(screen.getByRole("link")).toHaveAttribute("href", "/produto/colar-artesanal")
  })

  it("passes the sizes prop through to the image, defaulting when omitted", () => {
    const { rerender } = render(<ProductCard product={baseProduct} sizes="100vw" />)
    expect(screen.getByRole("img", { name: "Colar Artesanal" })).toHaveAttribute("sizes", "100vw")

    rerender(<ProductCard product={baseProduct} />)
    expect(screen.getByRole("img", { name: "Colar Artesanal" })).toHaveAttribute(
      "sizes",
      "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
    )
  })
})
