import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService, { RESET_TOKEN_TTL_MS } from "../../../../modules/seller/service"
import { sellerPasswordLink, sendSellerPasswordResetEmail } from "../../../../utils/seller-password-link"

// Same answer whether or not the e-mail exists, so the form cannot be used to
// find out who sells on the marketplace.
const GENERIC_LINK_MESSAGE = "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha."

type Logger = { info: (msg: string) => void; error: (msg: string) => void }

const RequestLinkSchema = z.object({
  email: z.string().email(),
})

const SetPasswordSchema = z.object({
  token: z.string().min(1, "Token obrigatório"),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres"),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const logger = req.scope.resolve("logger") as Logger
  const body = req.body as { token?: string }

  if (body?.token) {
    return handleSetPassword(req, res, sellerService, logger)
  }
  return handleRequestLink(req, res, sellerService, logger)
}

async function handleRequestLink(
  req: MedusaRequest,
  res: MedusaResponse,
  sellerService: SellerModuleService,
  logger: Logger
) {
  const parsed = RequestLinkSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() })
  }

  const [seller] = await sellerService.listSellers({ email: parsed.data.email })
  if (!seller || !["approved", "active"].includes(seller.status)) {
    return res.json({ message: GENERIC_LINK_MESSAGE })
  }

  const token = await sellerService.issuePasswordToken(seller.id, RESET_TOKEN_TTL_MS)
  // Not awaited: waiting on the e-mail provider would make answers for real
  // sellers measurably slower, revealing which e-mails are registered.
  // The token itself never reaches the logs: anyone reading them could use it.
  void sendSellerPasswordResetEmail(seller, sellerPasswordLink(token))
    .then(() => logger.info(`[sellers/set-password] link de redefinição enviado para o vendedor ${seller.id}`))
    .catch((err: unknown) =>
      logger.error(
        `[sellers/set-password] falha ao enviar o link para o vendedor ${seller.id}: ${err instanceof Error ? err.message : String(err)}`
      )
    )

  res.json({ message: GENERIC_LINK_MESSAGE })
}

async function handleSetPassword(
  req: MedusaRequest,
  res: MedusaResponse,
  sellerService: SellerModuleService,
  logger: Logger
) {
  // Validated before the token is consumed, so a typo does not burn the link.
  const parsed = SetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" })
  }

  const sellerId = await sellerService.consumePasswordToken(parsed.data.token)
  if (!sellerId) {
    return res.status(400).json({ error: "Link inválido ou expirado. Peça um novo." })
  }

  const [seller] = await sellerService.listSellers({ id: sellerId })
  if (!seller || !["approved", "active"].includes(seller.status)) {
    return res.status(403).json({ error: "Conta ainda não aprovada. Aguarde a análise da equipe." })
  }

  await sellerService.updateSellers({
    selector: { id: seller.id },
    data: { passwordHash: SellerModuleService.hashPassword(parsed.data.password), status: "active" as const },
  })
  logger.info(`[sellers/set-password] senha definida para o vendedor ${seller.id}`)

  // The store becomes active here, so search must pick it up. The password is
  // already saved: a failed notification is logged, not returned as an error.
  try {
    await req.scope.resolve(Modules.EVENT_BUS).emit({ name: "seller.status_changed", data: { id: seller.id } })
  } catch (err: unknown) {
    logger.error(
      `[sellers/set-password] falha ao avisar a mudança de status do vendedor ${seller.id}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  res.json({ message: "Senha configurada com sucesso. Agora você pode acessar o portal do vendedor." })
}
