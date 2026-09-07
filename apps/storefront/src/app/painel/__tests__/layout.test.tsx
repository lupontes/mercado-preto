// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PainelLayout from "../layout"
import * as sellerApi from "@/lib/seller-api"
import { useSellerStore } from "@/lib/seller-store"

const replace = vi.fn()
const push = vi.fn()
let pathname = "/painel/dashboard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => pathname,
}))

describe("PainelLayout", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    replace.mockClear()
    push.mockClear()
    useSellerStore.setState({ seller: null })
    pathname = "/painel/dashboard"
  })

  it("renders children once /seller/me confirms an authenticated session", async () => {
    vi.spyOn(sellerApi, "getMe").mockResolvedValue({
      seller: { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" },
    })

    render(<PainelLayout><p>Conteúdo protegido</p></PainelLayout>)

    expect(await screen.findByText("Conteúdo protegido")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it("redirects to login when /seller/me rejects", async () => {
    vi.spyOn(sellerApi, "getMe").mockRejectedValue(new Error("Token inválido ou expirado"))

    render(<PainelLayout><p>Conteúdo protegido</p></PainelLayout>)

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/painel/login"))
    expect(screen.queryByText("Conteúdo protegido")).not.toBeInTheDocument()
  })

  it("renders the login page without checking the session", () => {
    pathname = "/painel/login"
    const getMe = vi.spyOn(sellerApi, "getMe")

    render(<PainelLayout><p>Formulário de login</p></PainelLayout>)

    expect(screen.getByText("Formulário de login")).toBeInTheDocument()
    expect(getMe).not.toHaveBeenCalled()
  })
})
