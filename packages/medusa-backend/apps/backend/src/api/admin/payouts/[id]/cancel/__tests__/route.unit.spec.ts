import { POST } from "../route"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /admin/payouts/:id/cancel", () => {
  it("cancels the payout and unlinks its commissions", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "pending" }])
    const cancelPayout = jest.fn().mockResolvedValue({ id: "payout_1", status: "cancelled" })
    const unlinkByPayout = jest.fn().mockResolvedValue(undefined)
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, cancelPayout },
        commission: { unlinkByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(unlinkByPayout).toHaveBeenCalledWith("payout_1")
    expect(cancelPayout).toHaveBeenCalledWith("payout_1")
    expect(res._status).toBe(200)
  })

  it("returns 404 and does not cancel when the payout does not exist", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const cancelPayout = jest.fn()
    const unlinkByPayout = jest.fn()
    const req = {
      params: { id: "payout_missing" },
      scope: makeScope({
        payout: { listPayouts, cancelPayout },
        commission: { unlinkByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(unlinkByPayout).not.toHaveBeenCalled()
  })

  it("returns 409 and does not cancel when the payout is not pending", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "completed" }])
    const cancelPayout = jest.fn()
    const unlinkByPayout = jest.fn()
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, cancelPayout },
        commission: { unlinkByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(409)
    expect(unlinkByPayout).not.toHaveBeenCalled()
    expect(cancelPayout).not.toHaveBeenCalled()
  })
})
