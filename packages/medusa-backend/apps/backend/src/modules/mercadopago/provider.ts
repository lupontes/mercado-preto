import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { MercadoPagoConfig, Payment, Preference } from "mercadopago"

type MercadoPagoOptions = {
  accessToken: string
}

class MercadoPagoPaymentProvider extends AbstractPaymentProvider<MercadoPagoOptions> {
  static identifier = "mercadopago"

  private mp: MercadoPagoConfig
  private preference: Preference
  private payment: Payment

  constructor(container: Record<string, unknown>, options: MercadoPagoOptions) {
    super(container, options)

    this.mp = new MercadoPagoConfig({
      accessToken: options.accessToken ?? process.env.MERCADOPAGO_ACCESS_TOKEN!,
    })
    this.preference = new Preference(this.mp)
    this.payment = new Payment(this.mp)
  }

  async initiatePayment(data: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context } = data

    try {
      const preference = await this.preference.create({
        body: {
          items: [
            {
              id: (context as any)?.idempotency_key ?? "default",
              title: "Pedido Mercado Preto",
              quantity: 1,
              unit_price: Number(amount) / 100,
              currency_id: (currency_code ?? "BRL").toUpperCase(),
            },
          ],
          payment_methods: {
            installments: 12,
          },
          back_urls: {
            success: `${process.env.STORE_CORS?.split(",")[0]}/checkout/sucesso`,
            failure: `${process.env.STORE_CORS?.split(",")[0]}/checkout/erro`,
            pending: `${process.env.STORE_CORS?.split(",")[0]}/checkout/pendente`,
          },
          ...(process.env.STORE_CORS?.split(",")[0]?.startsWith("https")
            ? { auto_return: "approved" as const }
            : {}),
        },
      })

      return {
        id: preference.id!,
        data: {
          preference_id: preference.id,
          init_point: preference.init_point,
          sandbox_init_point: preference.sandbox_init_point,
        },
      }
    } catch (err: unknown) {
      return this.buildError("Erro ao criar preferência MercadoPago", err as Error)
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const paymentId = input.data?.payment_id as string

    if (!paymentId) {
      return { data: (input.data as Record<string, unknown>) ?? {}, status: PaymentSessionStatus.PENDING }
    }

    try {
      const payment = await this.payment.get({ id: Number(paymentId) })
      const status = this.mapMPStatus(payment.status)
      return { data: { ...(input.data as Record<string, unknown>), payment }, status }
    } catch (err: unknown) {
      return this.buildError("Erro ao autorizar pagamento MercadoPago", err as Error)
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: (input.data as Record<string, unknown>) ?? {} }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const paymentId = input.data?.payment_id as string
    if (!paymentId) return { data: (input.data as Record<string, unknown>) ?? {} }

    try {
      await this.payment.cancel({ id: Number(paymentId) })
      return { data: { ...(input.data as Record<string, unknown>), cancelled: true } }
    } catch (err: unknown) {
      return this.buildError("Erro ao cancelar pagamento MercadoPago", err as Error)
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const paymentId = input.data?.payment_id as string

    try {
      const { PaymentRefund } = await import("mercadopago")
      const refund = new PaymentRefund(this.mp)
      await refund.create({
        payment_id: Number(paymentId),
        body: { amount: Number(input.amount ?? 0) / 100 },
      })
      return { data: { ...(input.data as Record<string, unknown>), refunded: true, refundAmount: input.amount } }
    } catch (err: unknown) {
      return this.buildError("Erro ao estornar pagamento MercadoPago", err as Error)
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const paymentId = input.data?.payment_id as string
    if (!paymentId) return { data: (input.data as Record<string, unknown>) ?? {} }

    try {
      const payment = await this.payment.get({ id: Number(paymentId) })
      return { data: { ...(input.data as Record<string, unknown>), payment } }
    } catch (err: unknown) {
      return this.buildError("Erro ao recuperar pagamento MercadoPago", err as Error)
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: (input.data as Record<string, unknown>) ?? {} }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const paymentId = input.data?.payment_id as string
    if (!paymentId) return { status: PaymentSessionStatus.PENDING }

    try {
      const payment = await this.payment.get({ id: Number(paymentId) })
      return { status: this.mapMPStatus(payment.status) }
    } catch {
      return { status: PaymentSessionStatus.ERROR }
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: (input.data as Record<string, unknown>) ?? {} }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const webhookData = payload.data as Record<string, unknown>
    const resource = webhookData as { resource?: string; action?: string }

    const paymentId = resource.resource?.split("/").pop()
    if (!paymentId) {
      return { action: "not_supported" }
    }

    try {
      const payment = await this.payment.get({ id: Number(paymentId) })
      const status = this.mapMPStatus(payment.status)

      if (status === PaymentSessionStatus.AUTHORIZED) {
        return {
          action: "authorized",
          data: {
            session_id: payment.external_reference as string,
            amount: Math.round((payment.transaction_amount ?? 0) * 100),
          },
        }
      }

      if (status === PaymentSessionStatus.CAPTURED) {
        return {
          action: "captured",
          data: {
            session_id: payment.external_reference as string,
            amount: Math.round((payment.transaction_amount ?? 0) * 100),
          },
        }
      }

      return {
        action: "failed",
        data: {
          session_id: payment.external_reference as string,
          amount: 0,
        },
      }
    } catch {
      return { action: "failed" }
    }
  }

  private mapMPStatus(mpStatus: string | undefined): PaymentSessionStatus {
    switch (mpStatus) {
      case "approved":
        return PaymentSessionStatus.CAPTURED
      case "authorized":
        return PaymentSessionStatus.AUTHORIZED
      case "in_process":
      case "pending":
        return PaymentSessionStatus.PENDING
      case "cancelled":
      case "refunded":
      case "charged_back":
        return PaymentSessionStatus.CANCELED
      default:
        return PaymentSessionStatus.ERROR
    }
  }

  private buildError(message: string, err: Error): any {
    return {
      error: message,
      code: "MERCADOPAGO_ERROR",
      detail: err?.message ?? String(err),
    }
  }
}

export default MercadoPagoPaymentProvider
