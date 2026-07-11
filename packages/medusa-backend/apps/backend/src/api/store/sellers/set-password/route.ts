import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"

const passwordResetTokens = new Map<string, { email: string; expiresAt: number }>()

const TOKEN_TTL_MS = 30 * 60 * 1000

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex")
}

const RequestResetSchema = z.object({
  email: z.string().email(),
})

const SetPasswordSchema = z.object({
  token: z.string().min(1, "Token obrigatório"),
  email: z.string().email(),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres"),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const logger = req.scope.resolve("logger")
  const body = req.body as { token?: string; email?: string; password?: string }

  if (body.token) {
    return handleSetPassword(req, res, sellerService, logger)
  }

  return handleRequestReset(req, res, sellerService, logger)
}

async function handleRequestReset(
  req: MedusaRequest,
  res: MedusaResponse,
  sellerService: SellerModuleService,
  logger: any
) {
  const parsed = RequestResetSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const { email } = parsed.data
  const [seller] = await sellerService.listSellers({ email })
  if (!seller) {
    return res.json({ message: "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha." })
  }

  if (!["approved", "active"].includes(seller.status)) {
    return res.json({ message: "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha." })
  }

  const token = generateToken()
  passwordResetTokens.set(token, { email, expiresAt: Date.now() + TOKEN_TTL_MS })

  logger.info(`[sellers/set-password] token gerado para ${email} — expira em 30min`)

  res.json({ message: "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha." })
}

async function handleSetPassword(
  req: MedusaRequest,
  res: MedusaResponse,
  sellerService: SellerModuleService,
  logger: any
) {
  const parsed = SetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const { token, email, password } = parsed.data

  const tokenData = passwordResetTokens.get(token)
  if (!tokenData) {
    return res.status(401).json({ error: "Token inválido ou expirado" })
  }

  if (Date.now() > tokenData.expiresAt) {
    passwordResetTokens.delete(token)
    return res.status(401).json({ error: "Token expirado. Solicite um novo." })
  }

  if (tokenData.email !== email) {
    return res.status(401).json({ error: "Token não corresponde ao e-mail informado" })
  }

  passwordResetTokens.delete(token)

  const [seller] = await sellerService.listSellers({ email })
  if (!seller) {
    return res.status(404).json({ error: "Vendedor não encontrado" })
  }

  if (!["approved", "active"].includes(seller.status)) {
    return res.status(403).json({ error: "Conta ainda não aprovada. Aguarde a análise da equipe." })
  }

  const passwordHash = SellerModuleService.hashPassword(password)
  await sellerService.updateSellers({
    selector: { id: seller.id },
    data: { passwordHash, status: "active" as const },
  })

  logger.info(`[sellers/set-password] senha redefinida para ${email}`)

  res.json({ message: "Senha configurada com sucesso. Agora você pode acessar o portal do vendedor." })
}
