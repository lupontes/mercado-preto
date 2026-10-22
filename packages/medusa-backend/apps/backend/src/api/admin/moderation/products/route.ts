import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { pendingChangesOf } from "../../../../utils/product-moderation"

const PAGE_SIZE = 200

/** Review queue: new (`proposed`) products and edits of approved ones, oldest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const items: { id: string; title: string; thumbnail: string | null; sellerName: string | null; kind: "new" | "change"; submittedAt: string }[] = []

  // Filtering on nested JSON metadata is unreliable in Medusa, so page through and filter in memory.
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { data: page } = await query.graph({
      entity: "product",
      fields: ["id", "title", "thumbnail", "status", "created_at", "metadata", "seller.name"],
      pagination: { take: PAGE_SIZE, skip, order: { created_at: "ASC" } },
    })
    for (const p of page as any[]) {
      const pending = pendingChangesOf(p)
      const base = { id: p.id, title: p.title, thumbnail: p.thumbnail ?? null, sellerName: p.seller?.name ?? null }
      if (pending) {
        items.push({ ...base, kind: "change", submittedAt: pending.submittedAt })
      } else if (p.status === "proposed") {
        items.push({ ...base, kind: "new", submittedAt: String(p.metadata?.submitted_at ?? p.created_at) })
      }
    }
    if (page.length < PAGE_SIZE) break
  }

  items.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
  res.json({ items })
}
