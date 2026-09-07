import { isSandboxMode } from "./sandbox"

export async function sendBrevoEmail(to: string, subject: string, htmlContent: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return

  let recipient = to
  if (isSandboxMode()) {
    const testRecipient = process.env.TEST_EMAIL_RECIPIENT
    if (!testRecipient) {
      console.error(
        "[sandbox] TEST_EMAIL_RECIPIENT não configurado — e-mail não enviado (destinatário real bloqueado em modo sandbox)"
      )
      return
    }
    recipient = testRecipient
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Mercado Preto", email: process.env.EMAIL_FROM || "noreply@mercadopreto.com.br" },
      to: [{ email: recipient }],
      subject,
      htmlContent,
    }),
  }).catch((err) => {
    console.error("[email] falha ao chamar a API da Brevo:", err)
    return null
  })

  if (res && !res.ok) {
    console.error(`[email] Brevo respondeu ${res.status} ao enviar para ${recipient}`)
  }
}
