import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

type ShippingRate = {
  id: string
  name: string
  company: string
  price: number
  currency: string
  delivery_time: string
}

// Melhor Envio API: retorna tarifas reais ou fallback quando token não configurado
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { cep, weight = "1", width = "15", height = "10", length = "20" } = req.query as Record<string, string>

  if (!cep || !/^\d{8}$/.test(cep.replace("-", ""))) {
    return res.status(400).json({ error: "CEP inválido. Informe 8 dígitos." })
  }

  const token = process.env.MELHOR_ENVIO_TOKEN
  const originCep = process.env.MELHOR_ENVIO_ORIGIN_CEP ?? "44300000" // Cachoeira/BA

  if (token) {
    try {
      const baseUrl = process.env.NODE_ENV === "production"
        ? "https://melhorenvio.com.br"
        : "https://sandbox.melhorenvio.com.br"
      const response = await fetch(`${baseUrl}/api/v2/me/shipment/calculate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mercado Preto (contato@mercadopreto.com.br)",
        },
        body: JSON.stringify({
          from: { postal_code: originCep.replace("-", "") },
          to: { postal_code: cep.replace("-", "") },
          package: {
            weight: Number(weight),
            width: Number(width),
            height: Number(height),
            length: Number(length),
          },
          services: "1,2,3,4,17",
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const rates: ShippingRate[] = data
          .filter((s: any) => !s.error && s.price)
          .map((s: any) => ({
            id: String(s.id),
            name: s.name,
            company: s.company?.name ?? s.name,
            price: Math.round(Number(s.price) * 100),
            currency: "brl",
            delivery_time: s.delivery_time ? `${s.delivery_time} dias úteis` : "A consultar",
          }))

        return res.json({ rates })
      }
    } catch {}
  }

  // Fallback — tarifas ilustrativas quando Melhor Envio não está configurado
  const fallback: ShippingRate[] = [
    {
      id: "pac",
      name: "PAC",
      company: "Correios",
      price: 2490,
      currency: "brl",
      delivery_time: "7–12 dias úteis",
    },
    {
      id: "sedex",
      name: "SEDEX",
      company: "Correios",
      price: 4990,
      currency: "brl",
      delivery_time: "2–5 dias úteis",
    },
  ]

  res.json({ rates: fallback, _mock: true })
}
