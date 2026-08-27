import { POST } from "../route"

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown, _headers: {} as Record<string, string> } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.setHeader = (name: string, value: string) => { res._headers[name] = value; return res }
  return res
}

describe("POST /store/sellers/logout", () => {
  it("clears the session cookie", async () => {
    const req = {} as any
    const res = makeRes()

    await POST(req, res)

    expect(res._headers["Set-Cookie"]).toContain("seller_session=")
    expect(res._headers["Set-Cookie"]).toContain("Max-Age=0")
    expect(res._body).toEqual({ message: "Logout realizado" })
  })
})
