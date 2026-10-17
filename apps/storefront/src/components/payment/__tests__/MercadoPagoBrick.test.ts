import { afterEach, describe, expect, it, vi } from "vitest"
import { submitPayment } from "../MercadoPagoBrick"

describe("submitPayment", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts directly to the Medusa store API, not the unreachable Next.js proxy route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ payment_id: "pay_1" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await submitPayment({ token: "card_tok" }, "ext_ref_1")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/checkout/payment"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-publishable-api-key": expect.any(String) }),
      })
    )
    const [calledUrl] = fetchMock.mock.calls[0]
    expect(calledUrl).not.toContain("/api/checkout/payment")
  })

  it("does not send transaction_amount: the server charges its own snapshot total", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ payment_id: "pay_1" }) })
    vi.stubGlobal("fetch", fetchMock)

    await submitPayment({ token: "card_tok" }, "ext_ref_1")

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ token: "card_tok", external_reference: "ext_ref_1" })
  })

  it("throws the backend error message when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(submitPayment({ token: "card_tok" }, "ext_ref_1")).rejects.toThrow("not found")
  })
})
