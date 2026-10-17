import {
  DEFAULT_PAYMENT_ERROR_MESSAGE,
  DEFAULT_REJECTION_MESSAGE,
  paymentErrorMessage,
  rejectionMessage,
} from "../mercadopago-messages"

describe("rejectionMessage", () => {
  it.each([
    ["cc_rejected_insufficient_amount", "Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix."],
    ["cc_rejected_bad_filled_card_number", "Confira o número do cartão."],
    ["cc_rejected_bad_filled_date", "Confira a data de validade do cartão."],
    ["cc_rejected_bad_filled_security_code", "Confira o código de segurança do cartão."],
    ["cc_rejected_bad_filled_other", "Confira os dados do cartão."],
    ["cc_rejected_call_for_authorize", "O banco pediu autorização para este pagamento. Ligue para o banco e tente de novo."],
    ["cc_rejected_card_disabled", "Este cartão está desativado. Ative-o com o banco ou use outro cartão."],
    ["cc_rejected_duplicated_payment", "Já existe um pagamento igual a este. Confira seu extrato antes de tentar de novo."],
    ["cc_rejected_high_risk", "O pagamento não foi aprovado. Tente outro cartão ou pague com Pix."],
    ["cc_rejected_blacklist", "O pagamento não foi aprovado. Tente outro cartão ou pague com Pix."],
    ["cc_rejected_max_attempts", "Você atingiu o limite de tentativas com este cartão. Use outro cartão ou pague com Pix."],
  ])("translates %s", (detail, message) => {
    expect(rejectionMessage(detail)).toBe(message)
  })

  it.each([["cc_rejected_something_new"], [undefined], [null]])("falls back to the default for %s", (detail) => {
    expect(rejectionMessage(detail)).toBe("O pagamento não foi aprovado. Tente outro cartão ou pague com Pix.")
    expect(DEFAULT_REJECTION_MESSAGE).toBe("O pagamento não foi aprovado. Tente outro cartão ou pague com Pix.")
  })
})

describe("paymentErrorMessage", () => {
  const emailMessage = "Não foi possível usar este e-mail no pagamento. Confira o e-mail ou use outro."

  it("translates code 2034 given as a number", () => {
    expect(paymentErrorMessage({ message: "x", cause: [{ code: 2034 }] })).toBe(emailMessage)
  })

  it("translates code 2034 given as a string", () => {
    expect(paymentErrorMessage({ cause: [{ code: "2034" }] })).toBe(emailMessage)
  })

  it.each([
    ["an Error without cause", new Error("boom")],
    ["an empty cause", { cause: [] }],
    ["a non-array cause", { cause: "nope" }],
    ["null", null],
    ["an unknown code", { cause: [{ code: 9999 }] }],
  ])("falls back to the default for %s", (_label, err) => {
    expect(paymentErrorMessage(err)).toBe("Não foi possível processar o pagamento. Tente novamente em instantes.")
    expect(DEFAULT_PAYMENT_ERROR_MESSAGE).toBe("Não foi possível processar o pagamento. Tente novamente em instantes.")
  })
})
