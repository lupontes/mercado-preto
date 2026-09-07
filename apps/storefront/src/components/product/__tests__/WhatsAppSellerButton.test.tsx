// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WhatsAppSellerButton } from "../WhatsAppSellerButton"

describe("WhatsAppSellerButton", () => {
  it("renders a wa.me link mentioning the seller and product when the phone is valid", () => {
    render(
      <WhatsAppSellerButton
        sellerName="Ateliê da Bahia"
        sellerPhone="(71) 99999-8888"
        productTitle="Cesta de Vime"
        productUrl="https://mercadopreto.com.br/produto/cesta-de-vime"
      />
    )

    const link = screen.getByRole("link", { name: /falar com o vendedor/i })
    expect(link).toHaveAttribute("href", expect.stringContaining("https://wa.me/5571999998888"))
    expect(link).toHaveAttribute("href", expect.stringContaining(encodeURIComponent("Cesta de Vime")))
  })

  it("renders nothing when the seller has no phone", () => {
    const { container } = render(
      <WhatsAppSellerButton
        sellerName="Ateliê da Bahia"
        sellerPhone={undefined}
        productTitle="Cesta de Vime"
        productUrl="https://mercadopreto.com.br/produto/cesta-de-vime"
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing when there is no seller name", () => {
    const { container } = render(
      <WhatsAppSellerButton
        sellerName={undefined}
        sellerPhone="(71) 99999-8888"
        productTitle="Cesta de Vime"
        productUrl="https://mercadopreto.com.br/produto/cesta-de-vime"
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
