// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import PerfilPage from "../page"
import * as sellerApi from "@/lib/seller-api"
import { useSellerStore } from "@/lib/seller-store"

const seller = { id: "seller_1", name: "Loja Teste", email: "loja@teste.com", status: "approved" }

describe("PerfilPage shipping address", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useSellerStore.setState({ seller: null })
  })

  it("autofills from ViaCEP on CEP blur and submits the address", async () => {
    const user = userEvent.setup()
    vi.spyOn(sellerApi, "getMe").mockResolvedValue({ seller })
    const patchMe = vi.spyOn(sellerApi, "patchMe").mockResolvedValue({ seller: { ...seller, addressCity: "Cachoeira" } })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ logradouro: "Rua Ana Nery", bairro: "Centro", localidade: "Cachoeira", uf: "BA" }),
    }))

    render(<PerfilPage />)

    await user.type(await screen.findByLabelText("CEP"), "44300000")
    await user.tab()

    await waitFor(() => expect(screen.getByLabelText("Rua")).toHaveValue("Rua Ana Nery"))
    expect(screen.getByLabelText("Bairro")).toHaveValue("Centro")
    expect(screen.getByLabelText("Cidade")).toHaveValue("Cachoeira")
    expect(screen.getByLabelText("UF")).toHaveValue("BA")

    await user.type(screen.getByLabelText("Número"), "12")
    await user.click(screen.getByRole("button", { name: "Salvar perfil" }))

    await waitFor(() => expect(patchMe).toHaveBeenCalled())
    expect(patchMe).toHaveBeenCalledWith(expect.objectContaining({
      addressPostalCode: "44300000", addressNumber: "12", addressCity: "Cachoeira",
    }))
  })

  it("omits the address block from the body when every address field is empty", async () => {
    const user = userEvent.setup()
    vi.spyOn(sellerApi, "getMe").mockResolvedValue({ seller })
    const patchMe = vi.spyOn(sellerApi, "patchMe").mockResolvedValue({ seller })

    render(<PerfilPage />)

    await user.click(await screen.findByRole("button", { name: "Salvar perfil" }))

    await waitFor(() => expect(patchMe).toHaveBeenCalled())
    const body = patchMe.mock.calls[0][0]
    expect(Object.keys(body).filter((k) => k.startsWith("address"))).toEqual([])
  })
})
