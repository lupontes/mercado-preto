jest.mock("@medusajs/medusa/core-flows", () => ({
  uploadFilesWorkflow: jest.fn(),
}))

import { POST } from "../route"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])

let logger: { error: jest.Mock }

function mockWorkflow(run: jest.Mock) {
  ;(uploadFilesWorkflow as unknown as jest.Mock).mockReturnValue({ run })
  return run
}

function makeReq(file?: { buffer: Buffer; originalname: string; mimetype: string }) {
  return {
    sellerId: "seller_1",
    file,
    scope: { resolve: (key: string) => (key === "logger" ? logger : undefined) },
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /seller/uploads", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    logger = { error: jest.fn() }
  })

  it("rejects a request without a file", async () => {
    const run = mockWorkflow(jest.fn())
    const res = makeRes()
    await POST(makeReq(), res)

    expect(res._status).toBe(400)
    expect(res._body).toEqual({ error: "Escolha uma foto para enviar." })
    expect(run).not.toHaveBeenCalled()
  })

  it("rejects a file whose bytes are not an image", async () => {
    const run = mockWorkflow(jest.fn())
    const res = makeRes()
    await POST(makeReq({ buffer: Buffer.from("<html><script>alert(1)</script></html>"), originalname: "foto.jpg", mimetype: "image/jpeg" }), res)

    expect(res._status).toBe(415)
    expect(res._body).toEqual({ error: "Envie uma foto em JPG, PNG ou WebP." })
    expect(run).not.toHaveBeenCalled()
  })

  it("stores a JPEG under a server-generated name", async () => {
    const run = mockWorkflow(jest.fn().mockResolvedValue({ result: [{ id: "f1", url: "https://site/static/123-produto.jpg" }] }))
    const res = makeRes()
    await POST(makeReq({ buffer: JPEG, originalname: "../../etc/passwd.jpg", mimetype: "text/plain" }), res)

    expect(res._status).toBe(201)
    expect(res._body).toEqual({ url: "https://site/static/123-produto.jpg" })
    const [file] = run.mock.calls[0][0].input.files
    expect(file.filename).toMatch(/^produto-seller_1-[0-9a-f-]{36}\.jpg$/)
    expect(file.mimeType).toBe("image/jpeg")
    expect(file.access).toBe("public")
    expect(file.content).toBe(JPEG.toString("base64"))
  })

  it("answers 500 without the raw error when the workflow fails", async () => {
    mockWorkflow(jest.fn().mockRejectedValue(new Error("disk full")))
    const res = makeRes()
    await POST(makeReq({ buffer: JPEG, originalname: "a.jpg", mimetype: "image/jpeg" }), res)

    expect(res._status).toBe(500)
    expect(res._body).toEqual({ error: "Não foi possível enviar a foto. Tente novamente." })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0].length).toBeLessThanOrEqual(2)
    expect(logger.error.mock.calls[0][0]).toContain("disk full")
  })
})
