import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_MODULE } from "../../../../modules/seller"
import SellerModuleService from "../../../../modules/seller/service"

const FAQ: Record<string, string> = {
  "horario": "🕐 Nosso atendimento é de segunda a sexta, das 9h às 18h (horário de Brasília).",
  "entrega": "📦 O prazo de entrega varia conforme a transportadora e a região. Você pode acompanhar pelo código de rastreamento enviado por e-mail.",
  "frete": "🚚 O frete é calculado no checkout com base no seu CEP. Trabalhamos com os Correios e transportadoras parceiras.",
  "devolucao": "↩️ Você tem 7 dias corridos após o recebimento para solicitar devolução. Entre em contato pelo WhatsApp ou e-mail.",
  "pagamento": "💳 Aceitamos PIX, cartão de crédito e boleto bancário. O PIX tem aprovação instantânea!",
  "vendedor": "🛍️ Somos um marketplace de afroemprendedores do Brasil. Cada loja é gerenciada por artesãs e artesãos independentes.",
  "artesanato": "🎨 Todos os produtos são feitos à mão por comunidades afrobrasileiras, principalmente do Recôncavo Baiano.",
  "mab": "🌺 O Mercado Preto é uma iniciativa da MAB — Mulheres de Axé do Brasil, sediada em Cachoeira/BA.",
}

async function sendEvolutionMessage(phone: string, message: string): Promise<void> {
  const apiUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_API_INSTANCE
  if (!apiUrl || !apiKey || !instance) return

  const digits = phone.replace(/\D/g, "")
  const normalized = digits.startsWith("55") ? digits : `55${digits}`

  await fetch(`${apiUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number: normalized, text: message }),
  }).catch(() => {})
}

function buildFaqResponse(text: string): string | null {
  const lower = text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
  for (const [keyword, response] of Object.entries(FAQ)) {
    if (lower.includes(keyword)) return response
  }
  return null
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const body = req.body as any
  const event = body?.event || body?.type

  if (event !== "messages.upsert" && event !== "message") {
    return res.status(200).json({ ok: true })
  }

  const message = body?.data?.message || body?.message
  const phone = body?.data?.key?.remoteJid || body?.from || ""
  const text: string = message?.conversation || message?.extendedTextMessage?.text || ""
  const fromMe: boolean = body?.data?.key?.fromMe ?? false

  if (fromMe || !text || !phone) return res.status(200).json({ ok: true })

  const faqReply = buildFaqResponse(text)
  if (faqReply) {
    await sendEvolutionMessage(phone, faqReply)
    return res.status(200).json({ ok: true, replied: true })
  }

  const lower = text.toLowerCase()

  if (lower.includes("loja") || lower.includes("vendedor") || lower.includes("artesa")) {
    const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
    const sellers = await sellerService.listSellers({ status: "active" }, { take: 5 })

    if (sellers.length > 0) {
      const storeUrl = (process.env.STORE_CORS || "http://localhost:3000").split(",")[0].trim()
      const list = sellers
        .map((s: any) => `• *${s.name}*${s.bio ? ` — ${s.bio.slice(0, 60)}` : ""}`)
        .join("\n")

      await sendEvolutionMessage(
        phone,
        `🛍️ Confira algumas de nossas lojas:\n\n${list}\n\nVeja todas em: ${storeUrl}/lojas`
      )
      return res.status(200).json({ ok: true, replied: true })
    }
  }

  await sendEvolutionMessage(
    phone,
    `Olá! 🌺 Sou o assistente do *Mercado Preto*.\n\n` +
    `Posso te ajudar com:\n` +
    `• Entrega e frete\n` +
    `• Formas de pagamento\n` +
    `• Devoluções\n` +
    `• Nossas lojas e artesãos\n\n` +
    `Qual é a sua dúvida? 😊`
  )

  res.status(200).json({ ok: true })
}
