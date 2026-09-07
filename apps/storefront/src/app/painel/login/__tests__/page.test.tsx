// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import PainelLoginPage from "../page"
import * as sellerApi from "@/lib/seller-api"
import { useSellerStore } from "@/lib/seller-store"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

describe("PainelLoginPage", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    push.mockClear()
    useSellerStore.setState({ seller: null })
  })

  it("stores the returned seller profile and navigates to the dashboard on success", async () => {
    const seller = { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" }
    vi.spyOn(sellerApi, "sellerLogin").mockResolvedValue({ seller })
    const user = userEvent.setup()

    render(<PainelLoginPage />)
    await user.type(screen.getByLabelText("E-mail"), "loja@teste.com")
    await user.type(screen.getByLabelText("Senha"), "secret123")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/painel/dashboard"))
    expect(useSellerStore.getState().seller).toEqual(seller)
  })

  it("shows the backend error message and does not navigate when login fails", async () => {
    vi.spyOn(sellerApi, "sellerLogin").mockRejectedValue(new Error("Credenciais inválidas"))
    const user = userEvent.setup()

    render(<PainelLoginPage />)
    await user.type(screen.getByLabelText("E-mail"), "loja@teste.com")
    await user.type(screen.getByLabelText("Senha"), "senhaerrada")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    expect(await screen.findByText("Credenciais inválidas")).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
