import { isSandboxMode } from "./sandbox"

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const apiUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_API_INSTANCE

  if (!apiUrl || !apiKey || !instance) return

  let targetPhone = phone
  if (isSandboxMode()) {
    const testRecipient = process.env.TEST_WHATSAPP_RECIPIENT
    if (!testRecipient) {
      console.error(
        "[sandbox] TEST_WHATSAPP_RECIPIENT não configurado — WhatsApp não enviado (destinatário real bloqueado em modo sandbox)"
      )
      return
    }
    targetPhone = testRecipient
  }

  const digits = targetPhone.replace(/\D/g, "")
  const normalized = digits.startsWith("55") ? digits : `55${digits}`

  await fetch(`${apiUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number: normalized, text: message }),
  }).catch(() => {})
}
