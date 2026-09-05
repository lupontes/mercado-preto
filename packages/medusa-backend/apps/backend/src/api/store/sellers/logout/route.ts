import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildClearCookie, SELLER_SESSION_COOKIE } from "../../../../utils/cookies"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader(
    "Set-Cookie",
    buildClearCookie(SELLER_SESSION_COOKIE, { secure: process.env.NODE_ENV === "production" })
  )
  res.json({ message: "Logout realizado" })
}
