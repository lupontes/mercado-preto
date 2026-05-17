import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MercadoPagoConfig, Payment } from "mercadopago"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const paymentId = req.query.payment_id as string | undefined
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN

  if (!paymentId) {
    return res.status(400).json({ error: "payment_id é obrigatório." })
  }

  if (!accessToken) {
    return res.status(503).json({ error: "MercadoPago não configurado." })
  }

  try {
    const mp = new MercadoPagoConfig({ accessToken })
    const paymentClient = new Payment(mp)
    const payment = await paymentClient.get({ id: Number(paymentId) })

    res.json({
      status: payment.status,
      status_detail: payment.status_detail,
      external_reference: payment.external_reference,
      transaction_amount: payment.transaction_amount,
      payer: {
        email: payment.payer?.email,
        first_name: (payment.payer as any)?.first_name,
        last_name: (payment.payer as any)?.last_name,
      },
      metadata: payment.metadata,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    res.status(500).json({ error: "Erro ao verificar pagamento.", detail: msg })
  }
}
