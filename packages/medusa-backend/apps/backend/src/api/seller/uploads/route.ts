import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { detectImageType } from "../../../utils/image-type"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId as string
  const file = (req as any).file as { buffer: Buffer } | undefined
  const logger = req.scope.resolve("logger") as { error: (msg: string) => void }

  if (!file?.buffer?.length) {
    return res.status(400).json({ error: "Escolha uma foto para enviar." })
  }

  const type = detectImageType(file.buffer)
  if (!type) {
    return res.status(415).json({ error: "Envie uma foto em JPG, PNG ou WebP." })
  }

  try {
    const { result } = await uploadFilesWorkflow(req.scope).run({
      input: {
        files: [
          {
            // The client's file name is never used: it may carry path segments.
            filename: `produto-${sellerId}-${crypto.randomUUID()}.${type.extension}`,
            mimeType: type.mimeType,
            content: file.buffer.toString("base64"),
            access: "public",
          },
        ],
      },
    })
    return res.status(201).json({ url: result[0].url })
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.error(`[seller/uploads] falha ao gravar a foto do vendedor ${sellerId}: ${detail}`)
    return res.status(500).json({ error: "Não foi possível enviar a foto. Tente novamente." })
  }
}
