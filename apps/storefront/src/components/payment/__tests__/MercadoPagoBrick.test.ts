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

  const respondWith = (body: unknown) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }))

  it("throws the translated reason when the card is rejected", async () => {
    respondWith({
      payment_id: 1,
      status: "rejected",
      status_detail: "cc_rejected_insufficient_amount",
      message: "Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix.",
    })

    await expect(submitPayment({ token: "card_tok" }, "ext_ref_1")).rejects.toThrow(
      "Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix."
    )
  })

  it("throws the default reason when a rejection has no message", async () => {
    respondWith({ status: "rejected" })

    await expect(submitPayment({ token: "card_tok" }, "ext_ref_1")).rejects.toThrow(
      "O pagamento não foi aprovado. Tente outro cartão ou pague com Pix."
    )
  })

  it.each(["approved", "pending", "in_process"])("resolves for %s", async (status) => {
    respondWith({ payment_id: "pay_1", status })

    await expect(submitPayment({ token: "card_tok" }, "ext_ref_1")).resolves.toMatchObject({ payment_id: "pay_1" })
  })
})
