jest.mock("../../../../utils/email", () => ({ sendBrevoEmail: jest.fn() }))

import { POST } from "../code/route"
import { sendBrevoEmail } from "../../../../utils/email"

const GENERIC = "Se houver compras com este documento, enviamos um código para o e-mail usado nelas."

let loyalty: { issueCode: jest.Mock }
let checkout: { findFirstPaidEmail: jest.Mock }
let logger: { info: jest.Mock; error: jest.Mock }

function makeReq(body: unknown) {
  const services: Record<string, unknown> = { loyalty, checkout, logger }
  return { body, scope: { resolve: (k: string) => services[k] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /store/loyalty/code", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    loyalty = { issueCode: jest.fn().mockResolvedValue("482913") }
    checkout = { findFirstPaidEmail: jest.fn().mockResolvedValue(null) }
    logger = { info: jest.fn(), error: jest.fn() }
  })

  it("rejects an invalid document", async () => {
    const res = makeRes()
    await POST(makeReq({ document: "123" }), res)
    expect(res._status).toBe(400)
  })

  it("answers the same way when the document never bought", async () => {
    const res = makeRes()
    await POST(makeReq({ document: "529.982.247-25" }), res)

    expect(res._body).toEqual({ message: GENERIC })
    expect(checkout.findFirstPaidEmail).toHaveBeenCalledWith("52998224725")
    expect(loyalty.issueCode).not.toHaveBeenCalled()
    expect(sendBrevoEmail).not.toHaveBeenCalled()
  })

  it("e-mails a code to the address of the last paid purchase", async () => {
    checkout.findFirstPaidEmail.mockResolvedValue("compradora@example.com")
    const res = makeRes()
    await POST(makeReq({ document: "529.982.247-25" }), res)

    expect(res._body).toEqual({ message: GENERIC })
    expect(loyalty.issueCode).toHaveBeenCalledWith("52998224725")
    const [to, , html] = (sendBrevoEmail as jest.Mock).mock.calls[0]
    expect(to).toBe("compradora@example.com")
    expect(html).toContain("482913")
    expect(JSON.stringify([logger.info.mock.calls, logger.error.mock.calls])).not.toContain("482913")
  })
})
