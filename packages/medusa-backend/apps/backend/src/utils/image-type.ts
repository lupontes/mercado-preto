export type DetectedImageType =
  | { mimeType: "image/jpeg"; extension: "jpg" }
  | { mimeType: "image/png"; extension: "png" }
  | { mimeType: "image/webp"; extension: "webp" }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Identifies an uploaded image by its leading bytes. The browser's
 * Content-Type and the file name are chosen by the client, so they are never
 * trusted: a renamed HTML or SVG file must not be served as a photo.
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" }
  }
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { mimeType: "image/png", extension: "png" }
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" }
  }
  return null
}
