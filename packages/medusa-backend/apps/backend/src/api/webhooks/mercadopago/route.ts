import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { IPaymentModuleService } from "@medusajs/framework/types"

// MercadoPago envia notificações de pagamento neste endpoint
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paymentService: IPaymentModuleService = req.scope.resolve(Modules.PAYMENT)

  try {
    await paymentService.processEvent({
      provider: "mercadopago",
      payload: {
        data: req.body,
        rawData: JSON.stringify(req.body),
        headers: req.headers as Record<string, string>,
      },
    })

    res.sendStatus(200)
  } catch (err) {
    req.scope.resolve("logger").error("Erro ao processar webhook MercadoPago:", err)
    res.sendStatus(500)
  }
}
