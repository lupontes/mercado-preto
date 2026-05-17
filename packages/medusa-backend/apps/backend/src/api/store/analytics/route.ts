import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const plausibleUrl = process.env.PLAUSIBLE_URL
  const domain = process.env.PLAUSIBLE_DOMAIN

  if (!plausibleUrl || !domain) {
    return res.status(204).end()
  }

  const { name, url, referrer, props } = req.body as any

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || ""

  await fetch(`${plausibleUrl}/api/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": req.headers["user-agent"] || "",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ name, url, domain, referrer, props }),
  }).catch(() => {})

  res.status(202).end()
}
