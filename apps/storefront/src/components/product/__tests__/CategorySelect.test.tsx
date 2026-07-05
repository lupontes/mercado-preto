// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CategorySelect } from "../CategorySelect"
import * as api from "@/lib/api"

describe("CategorySelect", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("always renders the 'no category' option", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({ product_categories: [], count: 0 })

    render(<CategorySelect value="" onChange={() => {}} />)

    expect(await screen.findByRole("option", { name: "Sem categoria" })).toBeInTheDocument()
  })

  it("renders categories fetched from the API", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({
      product_categories: [
        { id: "pcat_1", name: "Moda Africana", handle: "moda-africana" },
        { id: "pcat_2", name: "Bolsas", handle: "bolsas" },
      ],
      count: 2,
    })

    render(<CategorySelect value="" onChange={() => {}} />)

    expect(await screen.findByRole("option", { name: "Moda Africana" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Bolsas" })).toBeInTheDocument()
  })

  it("calls onChange with the selected category id", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue({
      product_categories: [{ id: "pcat_1", name: "Moda Africana", handle: "moda-africana" }],
      count: 1,
    })
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<CategorySelect value="" onChange={onChange} />)
    await screen.findByRole("option", { name: "Moda Africana" })

    await user.selectOptions(screen.getByRole("combobox"), "pcat_1")

    expect(onChange).toHaveBeenCalledWith("pcat_1")
  })

  it("logs and falls back to no categories when the fetch fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(api, "listCategories").mockRejectedValue(new Error("network error"))

    render(<CategorySelect value="" onChange={() => {}} />)

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("Failed to load categories", expect.any(Error)))
    expect(screen.getAllByRole("option")).toHaveLength(1)
  })
})
