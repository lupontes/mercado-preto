import express from "express"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import { MAX_IMAGE_BYTES, sellerImageUpload } from "../upload-middlewares"
import middlewares, { sellerUploadRateLimit } from "../../../middlewares"

// Exercises the real multer instance over HTTP, so size and field limits are
// tested as the browser would hit them.
let server: Server
let baseUrl: string

beforeAll(async () => {
  const app = express()
  app.post("/upload", sellerImageUpload, (req: any, res) => {
    res.json({ size: req.file?.buffer.length ?? null })
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

async function send(parts: Array<[string, number]>) {
  const form = new FormData()
  for (const [field, size] of parts) form.append(field, new Blob([Buffer.alloc(size)]), "foto.jpg")
  const res = await fetch(`${baseUrl}/upload`, { method: "POST", body: form })
  return { status: res.status, body: await res.json() }
}

describe("sellerImageUpload", () => {
  it("answers 413 for a file over 5 MB", async () => {
    const { status, body } = await send([["file", MAX_IMAGE_BYTES + 1]])
    expect(status).toBe(413)
    expect(body).toEqual({ error: "A foto passa de 5 MB. Escolha uma foto menor." })
  })

  it("answers 400 for two files", async () => {
    const { status, body } = await send([["file", 10], ["file", 10]])
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Escolha uma foto para enviar." })
  })

  it("answers 400 for a file in another field", async () => {
    const { status } = await send([["foto", 10]])
    expect(status).toBe(400)
  })

  it("answers 400 when extra text fields come with the file", async () => {
    const form = new FormData()
    form.append("note", "x".repeat(1000))
    form.append("file", new Blob([Buffer.alloc(10)]), "foto.jpg")
    const res = await fetch(`${baseUrl}/upload`, { method: "POST", body: form })
    expect(res.status).toBe(400)
  })

  it("hands a valid file to the next handler", async () => {
    const { status, body } = await send([["file", 10]])
    expect(status).toBe(200)
    expect(body).toEqual({ size: 10 })
  })
})

describe("route registration", () => {
  it("rate-limits and parses uploads on POST /seller/uploads", () => {
    const entry = middlewares.routes!.find((r) => r.matcher === "/seller/uploads")
    expect(entry?.methods).toEqual(["POST"])
    expect(entry?.middlewares).toEqual([sellerUploadRateLimit, sellerImageUpload])
  })
})
