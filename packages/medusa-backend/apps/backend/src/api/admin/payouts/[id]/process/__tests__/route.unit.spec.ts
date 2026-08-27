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

describe("POST /admin/payouts/:id/process", () => {
  it("processes the payout and marks its linked commissions as paid", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "pending" }])
    const markAsProcessed = jest.fn().mockResolvedValue({ id: "payout_1", status: "completed" })
    const markPaidByPayout = jest.fn().mockResolvedValue(undefined)
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, markAsProcessed },
        commission: { markPaidByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(markAsProcessed).toHaveBeenCalledWith("payout_1")
    expect(markPaidByPayout).toHaveBeenCalledWith("payout_1")
    expect(res._status).toBe(200)
  })

  it("returns 404 and does not call markPaidByPayout when payout does not exist", async () => {
    const listPayouts = jest.fn().mockResolvedValue([])
    const markAsProcessed = jest.fn()
    const markPaidByPayout = jest.fn()
    const req = {
      params: { id: "payout_missing" },
      scope: makeScope({
        payout: { listPayouts, markAsProcessed },
        commission: { markPaidByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(404)
    expect(markPaidByPayout).not.toHaveBeenCalled()
  })

  it("returns 409 and does not call markPaidByPayout when payout is already completed", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "completed" }])
    const markAsProcessed = jest.fn()
    const markPaidByPayout = jest.fn()
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, markAsProcessed },
        commission: { markPaidByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(409)
    expect(markPaidByPayout).not.toHaveBeenCalled()
  })

  it("returns 409 and does not call markPaidByPayout when payout is cancelled", async () => {
    const listPayouts = jest.fn().mockResolvedValue([{ id: "payout_1", status: "cancelled" }])
    const markAsProcessed = jest.fn()
    const markPaidByPayout = jest.fn()
    const req = {
      params: { id: "payout_1" },
      scope: makeScope({
        payout: { listPayouts, markAsProcessed },
        commission: { markPaidByPayout },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(409)
    expect(markPaidByPayout).not.toHaveBeenCalled()
  })
})
