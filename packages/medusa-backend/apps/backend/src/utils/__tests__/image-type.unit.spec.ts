import { detectImageType } from "../image-type"

const bytes = (...values: number[]) => Buffer.from(values)
const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(16)])

describe("detectImageType", () => {
  it("recognizes a JPEG", () => {
    expect(detectImageType(pad(bytes(0xff, 0xd8, 0xff, 0xe0)))).toEqual({ mimeType: "image/jpeg", extension: "jpg" })
  })

  it("recognizes a PNG", () => {
    expect(detectImageType(pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))).toEqual({ mimeType: "image/png", extension: "png" })
  })

  it("recognizes a WebP", () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), bytes(0x24, 0, 0, 0), Buffer.from("WEBPVP8 ")])
    expect(detectImageType(webp)).toEqual({ mimeType: "image/webp", extension: "webp" })
  })

  it.each([
    ["GIF", pad(Buffer.from("GIF89a"))],
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["PDF", pad(Buffer.from("%PDF-1.7"))],
    ["plain text", Buffer.from("hello")],
    ["an empty buffer", Buffer.alloc(0)],
    ["a RIFF that is not WebP (WAV)", Buffer.concat([Buffer.from("RIFF"), bytes(0x24, 0, 0, 0), Buffer.from("WAVEfmt ")])],
    ["a truncated JPEG", bytes(0xff, 0xd8)],
  ])("rejects %s", (_label, buffer) => {
    expect(detectImageType(buffer)).toBeNull()
  })
})
