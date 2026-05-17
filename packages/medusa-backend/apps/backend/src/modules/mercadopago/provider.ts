import {
  AbstractPaymentProvider,
  PaymentSessionStatus,
  type PaymentProviderError,
  type PaymentProviderSessionResponse,
  type CreatePaymentProviderSession,
  type UpdatePaymentProviderSession,
  type ProviderWebhookPayload,
  type WebhookActionResult,
} from "@medusajs/framework/utils"
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

  async initiatePayment(
    data: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const { amount, currency_code, context } = data

    try {
      const preference = await this.preference.create({
        body: {
          items: [
            {
              id: context.idempotency_key as string,
              title: "Pedido Mercado Preto",
              quantity: 1,
              unit_price: Number(amount) / 100,
              currency_id: currency_code.toUpperCase(),
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
          auto_return: "approved",
          // marketplace_fee aplicado quando aprovação de marketplace estiver ativa:
          // marketplace_fee: Math.round(Number(amount) * 0.15),
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

  async authorizePayment(
    data: Record<string, unknown>
  ): Promise<PaymentProviderError | { data: Record<string, unknown>; status: PaymentSessionStatus }> {
    const paymentId = data.payment_id as string

    if (!paymentId) {
      return { data, status: PaymentSessionStatus.PENDING }
    }

    try {
      const payment = await this.payment.get({ id: Number(paymentId) })

      const status = this.mapMPStatus(payment.status)
      return { data: { ...data, payment }, status }
    } catch (err: unknown) {
      return this.buildError("Erro ao autorizar pagamento MercadoPago", err as Error)
    }
  }

  async capturePayment(
    data: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    // MercadoPago captura automaticamente — apenas retornamos os dados
    return data
  }

  async cancelPayment(
    data: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const paymentId = data.payment_id as string

    if (!paymentId) return data

    try {
      await this.payment.cancel({ id: Number(paymentId) })
      return { ...data, cancelled: true }
    } catch (err: unknown) {
      return this.buildError("Erro ao cancelar pagamento MercadoPago", err as Error)
    }
  }

  async refundPayment(
    data: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const paymentId = data.payment_id as string

    try {
      const { Refund } = await import("mercadopago")
      const refund = new Refund(this.mp)
      await refund.create({
        payment_id: Number(paymentId),
        body: { amount: refundAmount / 100 },
      })
      return { ...data, refunded: true, refundAmount }
    } catch (err: unknown) {
      return this.buildError("Erro ao estornar pagamento MercadoPago", err as Error)
    }
  }

  async retrievePayment(
    data: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const paymentId = data.payment_id as string

    if (!paymentId) return data

    try {
      const payment = await this.payment.get({ id: Number(paymentId) })
      return { ...data, payment }
    } catch (err: unknown) {
      return this.buildError("Erro ao recuperar pagamento MercadoPago", err as Error)
    }
  }

  async deletePayment(
    data: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    return data
  }

  async getPaymentStatus(data: Record<string, unknown>): Promise<PaymentSessionStatus> {
    const paymentId = data.payment_id as string

    if (!paymentId) return PaymentSessionStatus.PENDING

    try {
      const payment = await this.payment.get({ id: Number(paymentId) })
      return this.mapMPStatus(payment.status)
    } catch {
      return PaymentSessionStatus.ERROR
    }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload
  ): Promise<WebhookActionResult> {
    const { data } = payload.data as { data: { id: string }; type: string }
    const type = (payload.data as { type: string }).type

    if (type !== "payment") {
      return { action: "not_supported" }
    }

    try {
      const payment = await this.payment.get({ id: Number(data.id) })
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

      return { action: "failed", data: { session_id: payment.external_reference as string } }
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

  private buildError(message: string, err: Error): PaymentProviderError {
    return {
      error: message,
      code: "MERCADOPAGO_ERROR",
      detail: err?.message ?? String(err),
    }
  }
}

export default MercadoPagoPaymentProvider
