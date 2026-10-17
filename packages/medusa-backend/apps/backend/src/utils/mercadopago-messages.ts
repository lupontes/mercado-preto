// Buyer-facing text for Mercado Pago outcomes. Raw MP messages are English and
// may carry internal details, so they only go to the logs.

export const DEFAULT_REJECTION_MESSAGE = "O pagamento não foi aprovado. Tente outro cartão ou pague com Pix."

export const DEFAULT_PAYMENT_ERROR_MESSAGE = "Não foi possível processar o pagamento. Tente novamente em instantes."

const REJECTION_MESSAGES: Record<string, string> = {
  cc_rejected_insufficient_amount: "Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix.",
  cc_rejected_bad_filled_card_number: "Confira o número do cartão.",
  cc_rejected_bad_filled_date: "Confira a data de validade do cartão.",
  cc_rejected_bad_filled_security_code: "Confira o código de segurança do cartão.",
  cc_rejected_bad_filled_other: "Confira os dados do cartão.",
  cc_rejected_call_for_authorize: "O banco pediu autorização para este pagamento. Ligue para o banco e tente de novo.",
  cc_rejected_card_disabled: "Este cartão está desativado. Ative-o com o banco ou use outro cartão.",
  cc_rejected_duplicated_payment: "Já existe um pagamento igual a este. Confira seu extrato antes de tentar de novo.",
  // Fraud-related reasons stay vague on purpose.
  cc_rejected_high_risk: DEFAULT_REJECTION_MESSAGE,
  cc_rejected_blacklist: DEFAULT_REJECTION_MESSAGE,
  cc_rejected_max_attempts: "Você atingiu o limite de tentativas com este cartão. Use outro cartão ou pague com Pix.",
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  "2034": "Não foi possível usar este e-mail no pagamento. Confira o e-mail ou use outro.",
}

export function rejectionMessage(statusDetail: string | null | undefined): string {
  return (statusDetail && REJECTION_MESSAGES[statusDetail]) || DEFAULT_REJECTION_MESSAGE
}

// The SDK rejects with either an Error or a plain API error object whose
// `cause` lists `{ code }` entries (code may be a number or a string).
export function paymentErrorMessage(err: unknown): string {
  const cause = (err as { cause?: unknown } | null)?.cause
  if (Array.isArray(cause)) {
    for (const entry of cause) {
      const message = ERROR_CODE_MESSAGES[String((entry as { code?: unknown })?.code)]
      if (message) return message
    }
  }
  return DEFAULT_PAYMENT_ERROR_MESSAGE
}
