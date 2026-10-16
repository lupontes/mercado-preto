// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PainelLayout from "../layout"
import * as sellerApi from "@/lib/seller-api"
import { useSellerStore } from "@/lib/seller-store"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/painel/dashboard",
}))

const BANNER = "Complete seu endereço de envio para que seus produtos possam ser vendidos."
const base = { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" }
const address = {
  addressPostalCode: "44300000", addressStreet: "Rua A", addressNumber: "1",
  addressDistrict: "Centro", addressCity: "Cachoeira", addressState: "BA",
}

describe("PainelLayout address banner", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useSellerStore.setState({ seller: null })
  })

  it("shows the banner with a link to the profile when the address is incomplete", async () => {
    vi.spyOn(sellerApi, "getMe").mockResolvedValue({ seller: base })

    render(<PainelLayout><p>Conteúdo</p></PainelLayout>)

    expect(await screen.findByText(BANNER, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Completar endereço" })).toHaveAttribute("href", "/painel/perfil")
  })

  it("hides the banner when the address is complete", async () => {
    vi.spyOn(sellerApi, "getMe").mockResolvedValue({ seller: { ...base, ...address } })

    render(<PainelLayout><p>Conteúdo</p></PainelLayout>)

    await screen.findByText("Conteúdo")
    expect(screen.queryByText(BANNER, { exact: false })).toBeNull()
  })
})
