import multer from "multer"

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const NO_FILE_MESSAGE = "Escolha uma foto para enviar."
const TOO_LARGE_MESSAGE = "A foto passa de 5 MB. Escolha uma foto menor."

// Kept in memory: the file is checked by its bytes before anything touches disk.
const parseSingleImage = multer({
  storage: multer.memoryStorage(),
  // Only the one file part is expected; text fields would just buffer in memory.
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
}).single("file")

/**
 * Parses one image from the "file" field. Multer reports limit breaches as
 * errors, which would otherwise reach the generic error handler as a 500.
 */
export function sellerImageUpload(req: any, res: any, next: any) {
  parseSingleImage(req, res, (err: unknown) => {
    if (!err) return next()
    // multer ships no type declarations, so its errors are recognized by name.
    const multerError = err as { name?: string; code?: string }
    if (multerError.name === "MulterError") {
      if (multerError.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: TOO_LARGE_MESSAGE })
      return res.status(400).json({ error: NO_FILE_MESSAGE })
    }
    next(err)
  })
}
