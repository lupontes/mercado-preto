import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { clientIp } from "../../../utils/client-ip"

const EventSchema = z.object({
  name: z.string().min(1).max(500),
  url: z.string().min(1).max(500),
  referrer: z.string().max(500).nullable().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const plausibleUrl = process.env.PLAUSIBLE_URL
  const domain = process.env.PLAUSIBLE_DOMAIN

  if (!plausibleUrl || !domain) {
    return res.status(204).end()
  }

  const parsed = EventSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Evento inválido" })
  }
  const { name, url, referrer, props } = parsed.data

  await fetch(`${plausibleUrl}/api/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": req.headers["user-agent"] || "",
      // Plausible counts unique visitors by IP: a forged address would skew them.
      "X-Forwarded-For": clientIp(req) ?? "",
    },
    body: JSON.stringify({ name, url, domain, referrer, props }),
  }).catch(() => {})

  res.status(202).end()
}
